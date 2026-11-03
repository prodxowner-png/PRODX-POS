import { createClient } from '@supabase/supabase-js';

// POS staff identity issuer is deliberately isolated from the Owner Console Auth project.
let supabaseClient: ReturnType<typeof createClient> | undefined;

export const getSupabasePosAuthClient = () => {
  if (supabaseClient) return supabaseClient;
  const url = import.meta.env.VITE_SUPABASE_POS_AUTH_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_POS_AUTH_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    throw new Error(
      'POS Supabase Auth is not configured. Set VITE_SUPABASE_POS_AUTH_URL and VITE_SUPABASE_POS_AUTH_PUBLISHABLE_KEY.',
    );
  }
  supabaseClient = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return supabaseClient;
};
