/** Secret values are configured with `wrangler secret put`, not checked into wrangler.jsonc. */
export function catalogSigningKey(env: Env): string {
  const key = (env as Env & { CATALOG_SIGNING_KEY: string }).CATALOG_SIGNING_KEY;
  if (typeof key !== "string" || key.length < 32) throw new Error("CATALOG_SIGNING_KEY_NOT_CONFIGURED");
  return key;
}
