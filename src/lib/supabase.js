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
