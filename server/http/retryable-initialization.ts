export const createRetryableInitialization = <Args extends unknown[], Result>(
  initialize: (...args: Args) => Promise<Result>,
): ((...args: Args) => Promise<Result>) => {
  let current: Promise<Result> | undefined;

  return (...args: Args): Promise<Result> => {
    if (!current) {
      let guarded: Promise<Result>;
      guarded = Promise.resolve()
        .then(() => initialize(...args))
        .catch((error: unknown) => {
          // Clear only this failed attempt; never discard a newer initialization.
          if (current === guarded) current = undefined;
          throw error;
        });
      current = guarded;
    }

    return current;
  };
};
