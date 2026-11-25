import type { Server } from 'node:http';
import { logger, safeErrorDiagnostic, type StructuredLogger } from './logger.ts';

export type ShutdownPool = {
  end: () => Promise<void>;
};

export type GracefulShutdownOptions = {
  server: Pick<Server, 'close'> & { closeIdleConnections?: () => void };
  pool: ShutdownPool;
  timeoutMs?: number;
  log?: StructuredLogger;
  exit?: (code: number) => void;
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export const resolveShutdownTimeoutMs = (rawValue: string | undefined = process.env.PRODX_SHUTDOWN_TIMEOUT_MS): number => {
  if (!rawValue) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed >= 100 ? parsed : DEFAULT_SHUTDOWN_TIMEOUT_MS;
};

export const createGracefulShutdownHandler = (options: GracefulShutdownOptions): ((signal: string) => Promise<void>) => {
  const timeoutMs = options.timeoutMs ?? resolveShutdownTimeoutMs();
  const log = options.log ?? logger;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info('server.shutdown_started', { signal, timeoutMs });

    const forceTimer = setTimeout(() => {
      log.error('server.shutdown_timeout', { signal, timeoutMs });
      exit(1);
    }, timeoutMs);
    forceTimer.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        options.server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        options.server.closeIdleConnections?.();
      });
      await options.pool.end();
      clearTimeout(forceTimer);
      log.info('server.shutdown_completed', { signal });
      exit(0);
    } catch (error: unknown) {
      clearTimeout(forceTimer);
      log.error('server.shutdown_failed', {
        signal,
        ...safeErrorDiagnostic(error),
      });
      exit(1);
    }
  };
};

export const installGracefulShutdown = (options: GracefulShutdownOptions): (() => void) => {
  const shutdown = createGracefulShutdownHandler(options);
  const onSigInt = () => {
    void shutdown('SIGINT');
  };
  const onSigTerm = () => {
    void shutdown('SIGTERM');
  };

  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);

  return () => {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
  };
};
