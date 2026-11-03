import { createClient } from '@supabase/supabase-js';

// POS and Owner experiences share PRODX-ORG; server-side identity binding and RBAC isolate access.
let supabaseClient: ReturnType<typeof createClient> | undefined;

export const getSupabasePosAuthClient = () => {
  if (supabaseClient) return supabaseClient;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    throw new Error(
      'Supabase Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for PRODX-ORG.',
    );
  }
  supabaseClient = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return supabaseClient;
};
