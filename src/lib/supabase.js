import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kndiyailsqrialgbozac.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_ANON_KEY environment variable');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
