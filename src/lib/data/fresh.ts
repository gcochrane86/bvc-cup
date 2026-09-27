/**
 * Wrap an async loader so concurrent calls share work but never return stale data:
 * a call made while a run is in flight waits for one follow-up run that starts after it.
 * Any number of calls during one run collapse into that single follow-up.
 */
export function freshOnly(fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  const start = (): Promise<void> => {
    running = fn().finally(() => (running = null));
    return running;
  };

  return () => {
    if (!running) return start();
    queued ??= running.catch(() => {}).then(() => {
      queued = null;
      return start();
    });
    return queued;
  };
}
