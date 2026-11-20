import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origin = Deno.env.get("OWNER_CONSOLE_ORIGIN") ?? "https://prodx-owner-console.vercel.app";
const corsHeaders = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "method_not_allowed" });

  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !publishableKey) return response(401, { error: "unauthorized" });

  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: userData, error: userError }, { data: aalData, error: aalError }] = await Promise.all([
    client.auth.getUser(token),
    client.auth.mfa.getAuthenticatorAssuranceLevel(token),
  ]);

  if (userError || !userData.user) return response(401, { error: "invalid_session" });
  if (userData.user.app_metadata?.owner_role !== "owner") return response(403, { error: "owner_role_required" });
  if (aalError || aalData.currentLevel !== "aal2") return response(403, { error: "aal2_required" });

  return response(200, {
    authorized: true,
    user: { id: userData.user.id, email: userData.user.email },
    assuranceLevel: aalData.currentLevel,
  });
});
