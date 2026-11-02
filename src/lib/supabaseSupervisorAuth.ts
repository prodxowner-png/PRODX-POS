import { createClient } from '@supabase/supabase-js';

export type SupervisorSupabaseProof = { accessToken: string; subject: string };

export async function authenticateSupervisorWithSupabase(email: string, password: string): Promise<SupervisorSupabaseProof> {
  const url = import.meta.env.VITE_SUPABASE_POS_AUTH_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_POS_AUTH_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) throw new Error('Supervisor reauthentication is not configured for the POS Auth project.');
  if (!email.trim() || !password) throw new Error('Supervisor email and account password are required.');

  // Use an isolated, non-persistent client so manager reauthentication cannot
  // replace the cashier's active Supabase session in the POS application.
  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session?.access_token || !data.user?.id) {
    throw new Error('Supervisor account reauthentication failed. Check the account password and try again.');
  }
  return { accessToken: data.session.access_token, subject: data.user.id };
}
