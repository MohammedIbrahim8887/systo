/** Shared work across windows/polls. A slow provider never delays the first response. */
export class ProgressiveCache<T> {
  private entries = new Map<string, { value?: T; promise?: Promise<void>; expires: number }>();
  constructor(private ttl = 120000, private limit = 200) {}

  read(key: string, load: () => Promise<T>, fallback: T): { value: T; pending: boolean } {
    let entry = this.entries.get(key);
    if (!entry) {
      // Do not evict running work: another window must join it, not start it again.
      if (this.entries.size >= this.limit) {
        const oldest = [...this.entries].find(([, e]) => !e.promise);
        if (oldest) this.entries.delete(oldest[0]);
      }
      entry = { expires: 0 };
      this.entries.set(key, entry);
    }
    if (!entry.promise && entry.expires <= Date.now()) {
      const current = entry;
      current.promise = Promise.resolve().then(load).then(value => {
        current.value = value;
        current.expires = Date.now() + this.ttl;
      }).catch(() => {
        current.value ??= fallback;
        current.expires = Date.now() + 10000;
      }).finally(() => { current.promise = undefined; });
    }
    return { value: entry.value ?? fallback, pending: Boolean(entry.promise) };
  }
}

/** Bound background scans and provider probes independently of how often views poll. */
export function taskQueue(concurrency: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>(resolve => waiters.push(resolve));
    else active++;
    try { return await job(); }
    finally {
      const next = waiters.shift();
      if (next) next(); else active--;
    }
  };
}
