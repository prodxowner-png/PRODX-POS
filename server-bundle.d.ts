export declare const createProductionApp: (options?: {
  vercelOidcToken?: string;
}) => Promise<{
  app: import('express').Express;
  pool: import('pg').Pool;
}>;
export declare const createRetryableInitialization: <Args extends unknown[], Result>(
  initialize: (...args: Args) => Promise<Result>,
) => (...args: Args) => Promise<Result>;
