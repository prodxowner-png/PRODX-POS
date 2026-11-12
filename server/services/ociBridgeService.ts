export interface OciTenancyStatus {
  name: string;
  homeRegionKey: string;
  lifecycleState: string;
  timeCreated: string | null;
  integration: 'read-only';
  checkedAt: string;
  latencyMs: number;
}

export type OciBridgeResult =
  | { ok: true; status: OciTenancyStatus }
  | { ok: false; statusCode: 502 | 503 | 504; code: string };

export interface OciBridgeEnv {
  OCI_BRIDGE_PREVIEW_URL?: string;
  OCI_BRIDGE_ACCESS_CLIENT_ID?: string;
  OCI_BRIDGE_ACCESS_CLIENT_SECRET?: string;
  OCI_BRIDGE_BEARER_TOKEN?: string;
}

const PREVIEW_HOST = /^[a-f0-9]{8}-prodx-oci-bridge-staging\.prodx-pos\.workers\.dev$/i;
const REQUEST_TIMEOUT_MS = 10_000;

function readEndpoint(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash || !PREVIEW_HOST.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function getOciTenancyStatus(
  env: OciBridgeEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<OciBridgeResult> {
  const endpoint = readEndpoint(env.OCI_BRIDGE_PREVIEW_URL);
  const accessClientId = env.OCI_BRIDGE_ACCESS_CLIENT_ID?.trim();
  const accessClientSecret = env.OCI_BRIDGE_ACCESS_CLIENT_SECRET?.trim();
  const bridgeBearerToken = env.OCI_BRIDGE_BEARER_TOKEN?.trim();

  if (!endpoint || !accessClientId || !accessClientSecret || !bridgeBearerToken) {
    return { ok: false, statusCode: 503, code: 'OCI_BRIDGE_NOT_CONFIGURED' };
  }

  const started = performance.now();
  let response: Response;
  try {
    response = await fetchImpl(new URL('/v1/oci/tenancy', endpoint), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${bridgeBearerToken}`,
        'cf-access-client-id': accessClientId,
        'cf-access-client-secret': accessClientSecret,
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, statusCode: 504, code: 'OCI_BRIDGE_TIMEOUT' };
    }
    return { ok: false, statusCode: 502, code: 'OCI_BRIDGE_UNAVAILABLE' };
  }

  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, statusCode: 502, code: 'OCI_BRIDGE_AUTHENTICATION_FAILED' };
    }
    return { ok: false, statusCode: 502, code: 'OCI_BRIDGE_UPSTREAM_REJECTED' };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, statusCode: 502, code: 'OCI_BRIDGE_INVALID_RESPONSE' };
  }

  const tenancy = payload && typeof payload === 'object'
    ? (payload as { tenancy?: unknown }).tenancy
    : undefined;
  if (!tenancy || typeof tenancy !== 'object') {
    return { ok: false, statusCode: 502, code: 'OCI_BRIDGE_INVALID_RESPONSE' };
  }

  const record = tenancy as Record<string, unknown>;
  if (typeof record.name !== 'string' || typeof record.home_region_key !== 'string' ||
      typeof record.lifecycle_state !== 'string' ||
      (record.time_created !== undefined && record.time_created !== null && typeof record.time_created !== 'string')) {
    return { ok: false, statusCode: 502, code: 'OCI_BRIDGE_INVALID_RESPONSE' };
  }

  return {
    ok: true,
    status: {
      name: record.name,
      homeRegionKey: record.home_region_key,
      lifecycleState: record.lifecycle_state,
      timeCreated: typeof record.time_created === 'string' ? record.time_created : null,
      integration: 'read-only',
      checkedAt: new Date().toISOString(),
      latencyMs: Number((performance.now() - started).toFixed(1)),
    },
  };
}
