import { createClient } from '@supabase/supabase-js';
import { isValidOwnerSupabaseConfig } from './authFlow.ts';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
)?.trim();

export const supabaseConfigReady = isValidOwnerSupabaseConfig(
  supabaseUrl,
  supabasePublishableKey,
);

export const supabase = supabaseConfigReady
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: 'prodx-owner-console-auth',
      },
    })
  : null;