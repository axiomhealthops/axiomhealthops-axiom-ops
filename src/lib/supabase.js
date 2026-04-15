import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kndiyailsqrialgbozac.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_ANON_KEY environment variable');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Defensive update wrapper.
 *
 * Why this exists:
 *   Supabase silently rejects an entire .update() payload if any key
 *   references a column that doesn't exist on the table. The PostgREST
 *   response is success-shaped but no row is changed, and historically
 *   our pages just called .eq() and assumed it worked. That's the
 *   "save button does nothing, no error" silent-failure pattern called
 *   out in the project handoff.
 *
 * What this does:
 *   1. Runs supabase.from(table).update(payload).match(matchObj).select()
 *      so PostgREST returns the affected rows (instead of just 204).
 *   2. Returns { data, error, rowCount }.
 *   3. If no error AND rowCount === 0, logs a console.warn so silent
 *      no-op updates surface in DevTools instead of disappearing.
 *
 * Callers should always check `error` AND act on `rowCount === 0`
 * (treat it as a save failure for the user).
 *
 * @param {string} table - Supabase table name
 * @param {Record<string, any>} payload - column → value to update
 * @param {Record<string, any>} matchObj - filter (typically { id })
 * @returns {Promise<{ data: any[]|null, error: any, rowCount: number }>}
 */
export async function safeUpdate(table, payload, matchObj) {
  if (!table || typeof table !== 'string') {
    return { data: null, error: new Error('safeUpdate: table name is required'), rowCount: 0 };
  }
  if (!payload || typeof payload !== 'object') {
    return { data: null, error: new Error('safeUpdate: payload must be an object'), rowCount: 0 };
  }
  if (!matchObj || typeof matchObj !== 'object' || Object.keys(matchObj).length === 0) {
    // Refusing to run an unfiltered UPDATE is a feature, not a bug.
    return { data: null, error: new Error('safeUpdate: refusing to run without a match filter (would update entire table)'), rowCount: 0 };
  }

  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .match(matchObj)
    .select();

  const rowCount = Array.isArray(data) ? data.length : 0;

  if (!error && rowCount === 0) {
    // Silent reject signature: PostgREST returned success but nothing changed.
    // Most common cause: payload contained a column the table doesn't have,
    // OR the match filter didn't find any rows, OR an RLS policy filtered
    // the row out of the returning set.
    console.warn(
      `[safeUpdate] ${table}: 0 rows affected. Possible causes: ` +
      `(a) payload references a column that doesn't exist on the table, ` +
      `(b) match filter ${JSON.stringify(matchObj)} matched no rows, ` +
      `(c) RLS policy blocked the update.`
    );
  }

  return { data, error, rowCount };
}

/**
 * Paginated fetch that bypasses the PostgREST 1000-row silent cap.
 *
 * Why this exists:
 *   supabase.from(t).select(...).limit(N) is silently capped at ~1000
 *   rows on the server regardless of N. Pages that call .limit(3000)
 *   or .limit(10000) receive only 1000 rows and silently undercount.
 *   Symptoms have included "Overview shows 0 scheduled visits" and
 *   "Crystal shows 0 / Productivity undercounts by half".
 *
 * What this does:
 *   Repeatedly issues .range(offset, offset+999) until an empty or
 *   short page comes back, accumulating rows into a single array.
 *   Works with any QueryBuilder — pass in the builder AFTER chaining
 *   your .from / .select / .eq / .gte / .order / etc., and before
 *   terminating with .limit or .range. Example:
 *
 *     const rows = await fetchAllPages(
 *       supabase.from('visit_schedule_data')
 *         .select('*')
 *         .gte('visit_date', weekStart)
 *         .lte('visit_date', weekEnd)
 *         .order('visit_date', { ascending: false })
 *     );
 *
 * Safety stop at 50,000 rows. If you need more, rethink the query.
 *
 * @param {import('@supabase/postgrest-js').PostgrestFilterBuilder} builder
 * @returns {Promise<any[]>}
 */
export async function fetchAllPages(builder) {
  const PAGE = 1000;
  const MAX = 50000;
  const all = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    // Need a fresh builder per call — .range() mutates the original.
    // The .range() method returns a new PostgrestBuilder each call so this works.
    const { data, error } = await builder.range(offset, offset + PAGE - 1);
    if (error) {
      console.warn('[fetchAllPages] error at offset', offset, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) all.push(row);
    if (data.length < PAGE) break;
  }
  return all;
}
