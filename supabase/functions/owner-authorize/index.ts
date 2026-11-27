import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  createOwnerAuthorizeHandler,
  type OwnerAuthorizationDenial,
} from "./handler.ts";

const handler = createOwnerAuthorizeHandler({
  getEnv: (name) => Deno.env.get(name),
  createAuthClient: (url, publishableKey) =>
    createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  recordDenied: async (event: OwnerAuthorizationDenial) => {
    const url = Deno.env.get("SUPABASE_URL")?.trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!url || !serviceRoleKey) throw new Error("audit_not_configured");

    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.from("owner_security_audit_events").insert({
      event_type: "owner.authorization.denied",
      outcome: "denied",
      actor_user_id: event.actorUserId,
      reason_code: event.reasonCode,
      source: "server_verified",
    });
    if (error) throw error;
  },
});

Deno.serve(handler);
