export declare const createProductionApp: (options?: {
  vercelOidcToken?: string;
}) => Promise<{
  app: import('express').Express;
  pool: import('pg').Pool;
}>;
export declare const createRetryableInitialization: <Args extends unknown[], Result>(
  initialize: (...args: Args) => Promise<Result>,
) => (...args: Args) => Promise<Result>;
export declare const logger: {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};
export declare const safeErrorDiagnostic: (error: unknown) => Record<string, string | number>;
