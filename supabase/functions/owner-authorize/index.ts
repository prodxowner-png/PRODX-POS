import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { createOwnerAuthorizeHandler } from "./handler.ts";

const handler = createOwnerAuthorizeHandler({
  getEnv: (name) => Deno.env.get(name),
  createAuthClient: (url, publishableKey) =>
    createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
});

Deno.serve(handler);
