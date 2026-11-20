import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = (Deno.env.get("OWNER_CONSOLE_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function getAllowedOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin || allowedOrigins.length === 0) return null;

  let parsedOrigin: string;
  try {
    const parsed = new URL(requestOrigin);
    if (parsed.origin !== requestOrigin || !["https:", "http://localhost", "http://127.0.0.1"].some(
      (allowed) => parsed.origin.startsWith(allowed),
    )) return null;
    parsedOrigin = parsed.origin;
  } catch {
    return null;
  }

  return allowedOrigins.some((configured) => {
    try {
      return new URL(configured).origin === parsedOrigin && new URL(configured).origin === configured;
    } catch {
      return false;
    }
  }) ? parsedOrigin : null;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(status: number, body: Record<string, unknown>, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = getAllowedOrigin(req.headers.get("Origin"));
  if (!origin) return new Response("forbidden_origin", { status: 403 });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return response(405, { error: "method_not_allowed" }, origin);

  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token) return response(401, { error: "unauthorized" }, origin);
  if (!url || !publishableKey || allowedOrigins.length === 0) {
    return response(503, { error: "authorization_service_misconfigured" }, origin);
  }

  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [{ data: userData, error: userError }, { data: aalData, error: aalError }] = await Promise.all([
    client.auth.getUser(token),
    client.auth.mfa.getAuthenticatorAssuranceLevel(token),
  ]);

  if (userError || !userData.user) return response(401, { error: "invalid_session" }, origin);
  if (userData.user.app_metadata?.owner_role !== "owner") {
    return response(403, { error: "owner_role_required" }, origin);
  }
  if (aalError || aalData.currentLevel !== "aal2") {
    return response(403, { error: "aal2_required" }, origin);
  }

  return response(200, {
    authorized: true,
    user: { id: userData.user.id, email: userData.user.email },
    assuranceLevel: aalData.currentLevel,
  }, origin);
});
