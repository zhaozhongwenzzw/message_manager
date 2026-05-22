// Tiny concurrency limiter; avoids pulling in p-limit (ESM-only) for one helper.
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        fn()
          .then((v) => {
            active--;
            resolve(v);
            next();
          })
          .catch((e) => {
            active--;
            reject(e);
            next();
          });
      };
      queue.push(run);
      next();
    });
}
