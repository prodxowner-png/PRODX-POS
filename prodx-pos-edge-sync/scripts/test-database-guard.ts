const DISPOSABLE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);
const FORBIDDEN_QUERY_KEYS = new Set(["host", "hostaddr", "port", "service", "servicefile"]);

type DatabaseTarget = { hostname: string; port: string; database: string; username: string };
type GuardEnvironment = { POS_CI_MODE?: string; NODE_ENV?: string; VERCEL?: string; VERCEL_ENV?: string };

const parseTarget = (rawUrl: string | undefined, label: string, env: GuardEnvironment): { url: URL; target: DatabaseTarget } => {
  if (env.POS_CI_MODE !== "true") throw new Error(`${label}: POS_CI_MODE=true is required for database-writing CI integration tests.`);
  if (env.NODE_ENV === "production" || (env.VERCEL === "1" && env.VERCEL_ENV === "production")) {
    throw new Error(`${label}: refusing to run against a production runtime environment.`);
  }
  if (!rawUrl?.trim()) throw new Error(`${label}: a PostgreSQL connection URL is required.`);

  let url: URL;
  try { url = new URL(rawUrl.trim()); }
  catch { throw new Error(`${label}: connection URL must be valid.`); }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${label}: only postgres:// and postgresql:// URLs are allowed.`);
  }
  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_QUERY_KEYS.has(key.toLowerCase())) throw new Error(`${label}: URL query parameter ${key} can override the database target.`);
  }

  const hostname = url.hostname.toLowerCase();
  if (!DISPOSABLE_HOSTS.has(hostname)) throw new Error(`${label}: database host must be loopback or the local postgres service; received ${hostname}.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^prodx_pos_(?:[a-z0-9_]+_)?(?:ci|test)$/i.test(database)) {
    throw new Error(`${label}: database name must be a dedicated prodx_pos_*_ci or prodx_pos_*_test database.`);
  }
  return { url, target: { hostname, port: url.port || "5432", database, username: decodeURIComponent(url.username) } };
};

export const assertDisposableCiDatabaseUrl = (
  rawUrl: string | undefined,
  label = "Edge PostgreSQL integration",
  env: GuardEnvironment = { POS_CI_MODE: process.env.POS_CI_MODE, NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV },
): string => parseTarget(rawUrl, label, env).url.toString();

export const assertDisposableCiDatabasePair = (
  adminRawUrl: string | undefined,
  runtimeRawUrl: string | undefined,
  label = "Edge PostgreSQL integration",
  env: GuardEnvironment = { POS_CI_MODE: process.env.POS_CI_MODE, NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV },
): { adminUrl: string; runtimeUrl: string } => {
  const admin = parseTarget(adminRawUrl, `${label} admin connection`, env);
  const runtime = parseTarget(runtimeRawUrl, `${label} runtime connection`, env);
  const a = admin.target;
  const r = runtime.target;
  if (a.hostname !== r.hostname || a.port !== r.port || a.database !== r.database) {
    throw new Error(`${label}: admin and runtime connections must target the same disposable PostgreSQL database.`);
  }
  if (r.username !== "prodx_pos_worker" || r.username === a.username) {
    throw new Error(`${label}: runtime connection must use the dedicated prodx_pos_worker role, separate from the administrator.`);
  }
  return { adminUrl: admin.url.toString(), runtimeUrl: runtime.url.toString() };
};
