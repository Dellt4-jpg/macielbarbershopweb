import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured =
  /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(SUPABASE_URL) &&
  SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('TU-') &&
  typeof window.supabase?.createClient === 'function';

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;
