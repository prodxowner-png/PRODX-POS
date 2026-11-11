interface Env {
  BRIDGE_AUTH_TOKEN: string;
  OCI_TENANCY_OCID: string;
  OCI_USER_OCID: string;
  OCI_FINGERPRINT: string;
  OCI_REGION: string;
  OCI_PRIVATE_KEY_PEM: string;
}
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const REGION = "ap-singapore-1";
const API_VERSION = "20160918";

function pemBytes(pem: string): Uint8Array {
  const clean = pem.trim();
  if (!clean.startsWith("-----BEGIN PRIVATE KEY-----") || !clean.endsWith("-----END PRIVATE KEY-----")) {
    throw new Error("OCI_PRIVATE_KEY_MUST_BE_PKCS8_PEM");
  }
  const binary = atob(clean.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, ""));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function b64(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}
async function bearerMatches(received: string, expected: string): Promise<boolean> {
  const [a,b] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(received)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected))
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b); let diff = 0;
  for (let i=0;i<x.length;i++) diff |= x[i]! ^ y[i]!;
  return diff === 0 && received.length > 0 && expected.length >= 32;
}
function validate(env: Env): void {
  if (!env.BRIDGE_AUTH_TOKEN || env.BRIDGE_AUTH_TOKEN.length < 32) throw new Error("BRIDGE_TOKEN_MISSING");
  if (!env.OCI_TENANCY_OCID || !env.OCI_USER_OCID) throw new Error("OCI_OCID_MISSING");
  if (!/^([0-9a-f]{2}:){15}[0-9a-f]{2}$/i.test(env.OCI_FINGERPRINT)) throw new Error("OCI_FINGERPRINT_INVALID");
  if (env.OCI_REGION !== REGION) throw new Error("OCI_REGION_NOT_ALLOWED");
  if (!env.OCI_PRIVATE_KEY_PEM) throw new Error("OCI_KEY_MISSING");
}
async function authorization(env: Env, host: string, path: string, date: string): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(env.OCI_PRIVATE_KEY_PEM),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signingString = "(request-target): get " + path + "\nhost: " + host + "\ndate: " + date;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingString));
  const keyId = [env.OCI_TENANCY_OCID, env.OCI_USER_OCID, env.OCI_FINGERPRINT].join("/");
  return 'Signature version="1",keyId="' + keyId + '",algorithm="rsa-sha256",headers="(request-target) host date",signature="' + b64(new Uint8Array(signature)) + '"';
}
async function readTenancy(env: Env): Promise<Response> {
  validate(env);
  const host = "identity." + REGION + ".oraclecloud.com";
  const path = "/" + API_VERSION + "/tenancies/" + encodeURIComponent(env.OCI_TENANCY_OCID);
  const date = new Date().toUTCString();
  const auth = await authorization(env, host, path, date);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("https://" + host + path, {
      method: "GET", headers: { authorization: auth, date, accept: "application/json" }, signal: controller.signal
    });
    if (!response.ok) return json({ error: "OCI_UPSTREAM_REJECTED", upstream_status: response.status }, 502);
    const data = await response.json() as Record<string, unknown>;
    return json({ tenancy: {
      id: typeof data.id === "string" ? data.id : null,
      name: typeof data.name === "string" ? data.name : null,
      home_region_key: typeof data.homeRegionKey === "string" ? data.homeRegionKey : null,
      lifecycle_state: typeof data.lifecycleState === "string" ? data.lifecycleState : null,
      time_created: typeof data.timeCreated === "string" ? data.timeCreated : null
    }});
  } catch { return json({ error: "OCI_UPSTREAM_UNAVAILABLE" }, 502); }
  finally { clearTimeout(timeout); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return json({ service: "prodx-oci-bridge", status: "ready", integration: "read-only" });
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    if (url.pathname !== "/v1/oci/tenancy") return json({ error: "not_found" }, 404);
    if (url.search.length > 0) return json({ error: "query_not_allowed" }, 400);
    const token = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!(await bearerMatches(token, env.BRIDGE_AUTH_TOKEN ?? ""))) return json({ error: "unauthorized" }, 401);
    try { return await readTenancy(env); }
    catch { return json({ error: "bridge_configuration_invalid" }, 503); }
  }
};
