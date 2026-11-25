import crypto from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = {
  requestId?: string;
  traceId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  organizationId?: string;
  storeId?: string;
  [key: string]: unknown;
};

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  event: string;
} & LogFields;

export type StructuredLogger = {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
};

export type LoggerOptions = {
  writeStdout?: (line: string) => void;
  writeStderr?: (line: string) => void;
  now?: () => Date;
};

const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(authorization|cookie|set-cookie|password|passwd|secret|token|apikey|api_key|access_token|refresh_token|private_key|client_secret|credential|dsn|database_url|connectionstring|ca_cert)($|[_-])|authorization|password|secret|token|cookie|credential|private_key|api_key|apikey/i;

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const POSTGRES_DSN_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s'"]+/gi;
const MAX_REDACT_DEPTH = 6;

export const redactString = (value: string): string =>
  value
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(POSTGRES_DSN_PATTERN, 'postgresql://[REDACTED]');

export const redactValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_REDACT_DEPTH) return '[TRUNCATED]';

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (entryValue === undefined) continue;
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactValue(entryValue, depth + 1, seen);
      }
    }
    return result;
  }

  return String(value);
};

export const safeErrorDiagnostic = (error: unknown): Record<string, string | number> => {
  const candidate = error && typeof error === 'object'
    ? error as { name?: unknown; code?: unknown; syscall?: unknown; port?: unknown; stage?: unknown }
    : {};
  const diagnostic: Record<string, string | number> = {
    name: typeof candidate.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(candidate.name)
      ? candidate.name
      : 'unknown',
  };

  if (typeof candidate.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(candidate.code)) {
    diagnostic.code = candidate.code;
  }
  if (candidate.syscall === 'getaddrinfo' || candidate.syscall === 'connect' ||
      candidate.syscall === 'read' || candidate.syscall === 'write') {
    diagnostic.syscall = candidate.syscall;
  }
  if (typeof candidate.port === 'number' && Number.isInteger(candidate.port) &&
      candidate.port >= 1 && candidate.port <= 65535) {
    diagnostic.port = candidate.port;
  }
  if (candidate.stage === 'database_query' || candidate.stage === 'broker_fetch' ||
      candidate.stage === 'broker_http' || candidate.stage === 'broker_response') {
    diagnostic.stage = candidate.stage;
  }

  return diagnostic;
};

export type TraceContext = {
  traceId: string;
  spanId: string;
  traceFlags: string;
  traceparent: string;
};

const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ALL_ZERO_TRACE_ID = '00000000000000000000000000000000';
const ALL_ZERO_SPAN_ID = '0000000000000000';

export const parseTraceparent = (header: string | undefined): { traceId: string; parentId: string; traceFlags: string } | null => {
  if (!header) return null;
  const trimmed = header.trim().toLowerCase();
  const match = TRACEPARENT_REGEX.exec(trimmed);
  if (!match) return null;
  const [, version, traceId, parentId, traceFlags] = match;
  if (version === 'ff') return null;
  if (traceId === ALL_ZERO_TRACE_ID || parentId === ALL_ZERO_SPAN_ID) return null;
  return { traceId, parentId, traceFlags };
};

export const resolveTraceContext = (header: string | undefined): TraceContext => {
  const parsed = parseTraceparent(header);
  const traceId = parsed?.traceId ?? crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  const traceFlags = parsed?.traceFlags ?? '01';
  return {
    traceId,
    spanId,
    traceFlags,
    traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
  };
};

export const createLogger = (options: LoggerOptions = {}): StructuredLogger => {
  const writeStdout = options.writeStdout ?? ((line: string) => {
    process.stdout.write(`${line}\n`);
  });
  const writeStderr = options.writeStderr ?? ((line: string) => {
    process.stderr.write(`${line}\n`);
  });
  const now = options.now ?? (() => new Date());

  const emit = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const sanitized = redactValue(fields) as Record<string, unknown>;
    const entry: LogEntry = {
      timestamp: now().toISOString(),
      level,
      event,
      ...sanitized,
    };
    const serialized = JSON.stringify(entry);
    if (level === 'warn' || level === 'error') {
      writeStderr(serialized);
    } else {
      writeStdout(serialized);
    }
  };

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
};

export const logger: StructuredLogger = createLogger();
