import type { Pool } from 'pg';

export interface CloudSqlHealthCheckResult {
  service: 'PostgreSQL (Supabase session pooler)';
  statusCode: number;
  status: 'connected' | 'degraded' | 'unreachable';
  latencyMs: number;
  engine: string;
  region: string;
  projectId: string;
  database: string;
  serverTime?: string;
  poolStats?: { totalConnections: number; idleConnections: number; waitingRequests: number };
  queryProbe?: string;
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface FirestoreHealthCheckResult {
  service: 'Firestore (retired)';
  statusCode: number;
  status: 'disabled';
  latencyMs: number;
  databaseId: 'retired';
  projectId: 'retired';
  region: 'retired';
  endpoint: 'disabled';
  verifiedCollections: [];
  verificationMode: 'disabled';
  error: string;
}

export interface SystemHealthCheckResponse {
  statusCode: 200 | 207 | 503;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  timestamp: string;
  requestId: string;
  totalDurationMs: number;
  environment: {
    nodeEnv: string;
    appletId: string;
    region: string;
    cloudSqlProject: string;
    firestoreDatabaseId: string;
  };
  services: { cloudSql: CloudSqlHealthCheckResult; firestore: FirestoreHealthCheckResult };
  diagnostics: { activePeripheralsCount?: number; uptimeSeconds: number; memoryUsageMb: number };
  summary: string;
}

const POSTGRES_PROJECT_ID = 'wcyqyiewbzpmrekoljfw';
const POSTGRES_REGION = 'ap-southeast-1';
const APPLET_ID = '069bc919-d8b1-4f51-9f13-c61a86822990';

export async function pingCloudSql(pool?: Pool): Promise<CloudSqlHealthCheckResult> {
  const started = performance.now();
  const base = {
    service: 'PostgreSQL (Supabase session pooler)' as const,
    engine: 'PostgreSQL (Supabase session pooler)',
    region: POSTGRES_REGION,
    projectId: POSTGRES_PROJECT_ID,
    database: 'postgres',
  };
  if (!pool) {
    return {
      ...base, statusCode: 503, status: 'unreachable',
      latencyMs: Number((performance.now() - started).toFixed(1)),
      error: 'PostgreSQL pool is unavailable.',
      code: 'POSTGRES_POOL_UNAVAILABLE',
      details: { configured: false },
    };
  }
  try {
    const result = await pool.query<{ ping: number; server_time: string; version: string }>(
      'SELECT 1 AS ping, NOW() AS server_time, version() AS version;'
    );
    const latencyMs = Number((performance.now() - started).toFixed(1));
    const versionMatch = (result.rows[0]?.version || '').match(/PostgreSQL\s+([\d.]+)/i);
    return {
      ...base,
      engine: versionMatch ? `PostgreSQL ${versionMatch[1]} (Supabase session pooler)` : base.engine,
      statusCode: 200, status: 'connected', latencyMs,
      serverTime: result.rows[0]?.server_time || new Date().toISOString(),
      poolStats: {
        totalConnections: (pool as unknown as { totalCount?: number }).totalCount ?? 1,
        idleConnections: (pool as unknown as { idleCount?: number }).idleCount ?? 1,
        waitingRequests: (pool as unknown as { waitingCount?: number }).waitingCount ?? 0,
      },
      queryProbe: 'SELECT 1 -> OK',
    };
  } catch (error: unknown) {
    const candidate = error && typeof error === 'object' ? error as { message?: string; code?: string } : {};
    return {
      ...base, statusCode: 503, status: 'unreachable',
      latencyMs: Number((performance.now() - started).toFixed(1)),
      error: candidate.message || 'PostgreSQL health query failed.',
      code: candidate.code || 'QUERY_FAILED',
    };
  }
}

/** Firebase/Firestore was retired. This compatibility field explicitly reports that it is disabled. */
export async function pingFirestore(): Promise<FirestoreHealthCheckResult> {
  return {
    service: 'Firestore (retired)',
    statusCode: 503,
    status: 'disabled',
    latencyMs: 0,
    databaseId: 'retired',
    projectId: 'retired',
    region: 'retired',
    endpoint: 'disabled',
    verifiedCollections: [],
    verificationMode: 'disabled',
    error: 'Firestore integration was retired; PostgreSQL on Supabase is the production data store.',
  };
}

export async function performEndToEndHealthCheck(
  pool?: Pool,
  requestId: string = `shc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
): Promise<SystemHealthCheckResponse> {
  const overallStart = performance.now();
  const [postgres, firestore] = await Promise.all([pingCloudSql(pool), pingFirestore()]);
  const totalDurationMs = Number((performance.now() - overallStart).toFixed(1));
  const healthy = postgres.statusCode === 200;
  const memoryUsageMb = Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1));
  return {
    statusCode: healthy ? 200 : 503,
    status: healthy ? 'HEALTHY' : 'DOWN',
    timestamp: new Date().toISOString(),
    requestId,
    totalDurationMs,
    environment: {
      nodeEnv: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
      appletId: APPLET_ID,
      region: POSTGRES_REGION,
      cloudSqlProject: POSTGRES_PROJECT_ID,
      firestoreDatabaseId: 'retired',
    },
    services: { cloudSql: postgres, firestore },
    diagnostics: { uptimeSeconds: Math.floor(process.uptime()), memoryUsageMb },
    summary: healthy
      ? 'Supabase PostgreSQL health query succeeded. Firestore is retired and is not probed.'
      : 'Production PostgreSQL health query failed.',
  };
}
