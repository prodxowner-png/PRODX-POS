import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthContext, TerminalCheckpoint } from "./contracts";
import { readTerminalCheckpoint } from "./terminal-recovery";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Cache only the issuer's JWKS resolver (not request/user state) per isolate.
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwksFor(issuer: string) {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

async function verifiedClaims(request: Request, env: Env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new Response("Unauthorized", { status: 401 });
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  try {
    const { payload } = await jwtVerify(token, jwksFor(issuer), { issuer, audience: env.ACCESS_AUD });
    return payload;
  } catch { throw new Response("Unauthorized", { status: 401 }); }
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext> {
  const payload = await verifiedClaims(request, env);
  const tenantId = payload.tenant_id;
  const terminalId = payload.terminal_id;
  if (typeof tenantId !== "string" || typeof terminalId !== "string" ||
      !UUID.test(tenantId) || !UUID.test(terminalId)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { tenantId, terminalId, subject: String(payload.sub ?? "") };
}

export async function authenticateTenantOperator(request: Request, env: Env): Promise<{
  tenantId: string; subject: string;
}> {
  const payload = await verifiedClaims(request, env);
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (payload.role !== "POS_SYNC_AUDITOR" || typeof payload.tenant_id !== "string" ||
      !UUID.test(payload.tenant_id) || subject.length < 1 || subject.length > 255) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { tenantId: payload.tenant_id, subject };
}

export async function authenticateRecoveryOperator(request: Request, env: Env): Promise<{
  tenantId: string; subject: string;
}> {
  const payload = await verifiedClaims(request, env);
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (payload.role !== "POS_SYNC_RECOVERY_ADMIN" || typeof payload.tenant_id !== "string" ||
      !UUID.test(payload.tenant_id) || subject.length < 1 || subject.length > 255) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { tenantId: payload.tenant_id, subject };
}

export async function verifyTerminalCertificate(request: Request, env: Env, auth: AuthContext): Promise<TerminalCheckpoint> {
  const tls = (request as Request & { cf?: { tlsClientAuth?: {
    certVerified?: string; certRevoked?: boolean | string; certFingerprintSHA256?: string;
  } | null } }).cf?.tlsClientAuth;
  const revocationKnown = tls?.certRevoked === false || tls?.certRevoked === "0" || tls?.certRevoked === "false";
  if (!tls || tls.certVerified !== "SUCCESS" || !revocationKnown || !tls.certFingerprintSHA256) {
    throw new Response("Valid non-revoked mTLS client certificate required", { status: 403 });
  }
  const fingerprint = tls.certFingerprintSHA256.replace(/:/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Response("Invalid client certificate fingerprint", { status: 403 });

  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.HYPERDRIVE_DIRECT.connectionString });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id',$1,true)", [auth.tenantId]);
    const mapped = await client.query(
      `SELECT 1
         FROM terminal_devices d
        WHERE d.tenant_id=$1 AND d.terminal_id=$2 AND d.cert_fingerprint_sha256=$3::char(64)
          AND d.active=true AND d.revoked_at IS NULL AND d.not_before<=now()
          AND (d.not_after IS NULL OR d.not_after>now())
        LIMIT 1`,
      [auth.tenantId,auth.terminalId,fingerprint]
    );
    if (mapped.rowCount !== 1) throw new Response("mTLS certificate is not enrolled for this tenant/terminal", { status: 403 });
    const checkpoint = await readTerminalCheckpoint(client,auth.tenantId,auth.terminalId);
    await client.query("COMMIT");
    return checkpoint;
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    if (error instanceof Response) throw error;
    throw new Response("Terminal certificate authorization unavailable", { status: 503 });
  } finally {
    await client.end().catch(()=>undefined);
  }
}
