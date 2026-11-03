export interface CloudSqlServiceHealth {
  service: string; statusCode: number; status: 'connected' | 'degraded' | 'unreachable';
  latencyMs: number; engine: string; region: string; projectId: string; database: string;
  serverTime?: string; poolStats?: { totalConnections: number; idleConnections: number; waitingRequests: number };
  queryProbe?: string; error?: string; code?: string; details?: Record<string, unknown>;
}
export interface FirestoreServiceHealth {
  service: string; statusCode: number; status: 'disabled' | 'unreachable';
  latencyMs: number; databaseId: string; projectId: string; region: string; endpoint: string;
  verifiedCollections: string[]; httpStatus?: number; verificationMode: string; error?: string;
  clientDirectPingMs?: number; clientDirectStatus?: 'verified' | 'offline' | 'skipped';
}
export interface SystemHealthCheckResult {
  statusCode: 200 | 207 | 503; status: 'HEALTHY' | 'DEGRADED' | 'DOWN'; timestamp: string;
  requestId: string; totalDurationMs: number;
  environment: { nodeEnv: string; appletId: string; region: string; cloudSqlProject: string; firestoreDatabaseId: string };
  services: { cloudSql: CloudSqlServiceHealth; firestore: FirestoreServiceHealth };
  diagnostics: { clientOnline: boolean; uptimeSeconds?: number; memoryUsageMb?: number; roundTripNetworkMs: number };
  summary: string; rawJson: string;
}

const RETIRED_FIRESTORE: FirestoreServiceHealth = {
  service: 'Firestore (retired)', statusCode: 503, status: 'disabled', latencyMs: 0,
  databaseId: 'retired', projectId: 'retired', region: 'retired', endpoint: 'disabled',
  verifiedCollections: [], verificationMode: 'disabled',
  error: 'Firestore integration was retired; Supabase PostgreSQL is the production data store.',
};
const POSTGRES_FALLBACK: CloudSqlServiceHealth = {
  service: 'PostgreSQL (Supabase session pooler)', statusCode: 503, status: 'unreachable',
  latencyMs: 0, engine: 'PostgreSQL (Supabase session pooler)', region: 'ap-southeast-1',
  projectId: 'wcyqyiewbzpmrekoljfw', database: 'postgres',
  error: 'Backend API service is unreachable.',
};

export class SystemHealthCheckUtility {
  private static instance: SystemHealthCheckUtility;
  private lastResult: SystemHealthCheckResult | null = null;
  private listeners = new Set<(result: SystemHealthCheckResult) => void>();
  private autoPingTimer: ReturnType<typeof setInterval> | null = null;
  public static getInstance(): SystemHealthCheckUtility {
    if (!SystemHealthCheckUtility.instance) SystemHealthCheckUtility.instance = new SystemHealthCheckUtility();
    return SystemHealthCheckUtility.instance;
  }
  /** Query the production health endpoint. Never probe retired Firebase/Firestore services. */
  public async executePing(options?: { timeoutMs?: number }): Promise<SystemHealthCheckResult> {
    const started = performance.now();
    const requestId = `shc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10000);
    let payload: any = null;
    let httpStatus = 503;
    try {
      const response = await fetch('/api/v1/infrastructure/system-health-check', {
        method: 'GET', headers: { Accept: 'application/json', 'x-request-id': requestId },
        signal: controller.signal,
      });
      httpStatus = response.status;
      payload = await response.json().catch(() => null);
    } catch (error) {
      console.warn('[SystemHealthCheck] Backend endpoint unreachable:', error);
    } finally {
      clearTimeout(timer);
    }
    const roundTripNetworkMs = Number((performance.now() - started).toFixed(1));
    const postgres: CloudSqlServiceHealth = payload?.services?.cloudSql ?? {
      ...POSTGRES_FALLBACK, error: payload?.error || POSTGRES_FALLBACK.error,
    };
    const firestore: FirestoreServiceHealth = {
      ...RETIRED_FIRESTORE,
      ...(payload?.services?.firestore || {}),
      status: 'disabled',
      statusCode: 503,
      databaseId: 'retired', projectId: 'retired', region: 'retired',
      endpoint: 'disabled', verifiedCollections: [], verificationMode: 'disabled',
      clientDirectStatus: 'skipped',
    };
    const statusCode: 200 | 207 | 503 = payload?.statusCode === 200 && postgres.statusCode === 200 ? 200 : 503;
    const status: 'HEALTHY' | 'DEGRADED' | 'DOWN' = statusCode === 200 ? 'HEALTHY' : 'DOWN';
    const timestamp = payload?.timestamp || new Date().toISOString();
    const environment = {
      nodeEnv: payload?.environment?.nodeEnv || 'unknown',
      appletId: payload?.environment?.appletId || 'prodx-pos',
      region: payload?.environment?.region || 'ap-southeast-1',
      cloudSqlProject: payload?.environment?.cloudSqlProject || 'wcyqyiewbzpmrekoljfw',
      firestoreDatabaseId: 'retired',
    };
    const summary = payload?.summary || (httpStatus === 200
      ? 'Supabase PostgreSQL health query succeeded. Firestore is retired.'
      : 'Production PostgreSQL health check failed or API is unreachable.');
    const result: SystemHealthCheckResult = {
      statusCode, status, timestamp, requestId: payload?.requestId || requestId,
      totalDurationMs: Number(payload?.totalDurationMs ?? roundTripNetworkMs),
      environment, services: { cloudSql: postgres, firestore },
      diagnostics: {
        clientOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
        uptimeSeconds: payload?.diagnostics?.uptimeSeconds,
        memoryUsageMb: payload?.diagnostics?.memoryUsageMb,
        roundTripNetworkMs,
      },
      summary,
      rawJson: JSON.stringify({
        statusCode, status, timestamp, requestId: payload?.requestId || requestId,
        environment, services: { cloudSql: postgres, firestore }, summary,
      }, null, 2),
    };
    this.lastResult = result;
    this.notifyListeners(result);
    return result;
  }
  public getLastResult(): SystemHealthCheckResult | null { return this.lastResult; }
  public subscribe(callback: (result: SystemHealthCheckResult) => void): () => void {
    this.listeners.add(callback);
    if (this.lastResult) callback(this.lastResult);
    return () => this.listeners.delete(callback);
  }
  private notifyListeners(result: SystemHealthCheckResult): void {
    this.listeners.forEach((callback) => { try { callback(result); } catch (error) { console.error('[SystemHealthCheck] Listener error:', error); } });
  }
  public startAutoPing(intervalSeconds = 30): void {
    this.stopAutoPing();
    void this.executePing().catch(() => undefined);
    this.autoPingTimer = setInterval(() => { void this.executePing().catch(() => undefined); }, Math.max(5000, intervalSeconds * 1000));
  }
  public stopAutoPing(): void { if (this.autoPingTimer) { clearInterval(this.autoPingTimer); this.autoPingTimer = null; } }
  public isAutoPingActive(): boolean { return this.autoPingTimer !== null; }
}
export const systemHealthCheck = SystemHealthCheckUtility.getInstance();
