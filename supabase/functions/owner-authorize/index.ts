import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const allowedOrigins = new Set(
  (Deno.env.get("OWNER_CONSOLE_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  origin?: string,
) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...corsHeaders,
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);

  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  if (allowedOrigins.size === 0) {
    return jsonResponse(503, { error: "cors_not_configured" });
  }

  const origin = req.headers.get("Origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return jsonResponse(403, { error: "origin_not_allowed" });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Origin": origin,
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" }, origin);
  }

  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !publishableKey) {
    return jsonResponse(401, { error: "unauthorized" }, origin);
  }

  try {
    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [{ data: userData, error: userError }, { data: aalData, error: aalError }] =
      await Promise.all([
        client.auth.getUser(token),
        client.auth.mfa.getAuthenticatorAssuranceLevel(token),
      ]);

    if (userError || !userData.user) {
      return jsonResponse(401, { error: "invalid_session" }, origin);
    }
    if (userData.user.app_metadata?.owner_role !== "owner") {
      return jsonResponse(403, { error: "owner_role_required" }, origin);
    }
    if (aalError || aalData.currentLevel !== "aal2") {
      return jsonResponse(403, { error: "aal2_required" }, origin);
    }

    return jsonResponse(200, {
      authorized: true,
      user: { id: userData.user.id, email: userData.user.email },
      assuranceLevel: aalData.currentLevel,
    }, origin);
  } catch {
    return jsonResponse(503, { error: "authorization_unavailable" }, origin);
  }
});
