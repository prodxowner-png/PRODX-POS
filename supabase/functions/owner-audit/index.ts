import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { createOwnerAuditHandler } from "./handler.ts";

const handler = createOwnerAuditHandler({
  getEnv: (name) => Deno.env.get(name),
  createAuthClient: (url, publishableKey) =>
    createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  createAdminClient: (url, serviceRoleKey) =>
    createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
});

Deno.serve(handler);
