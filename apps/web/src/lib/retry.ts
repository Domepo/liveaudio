import { jitterMs, sleep } from "./time";

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; baseDelayMs: number; maxDelayMs: number; shouldRetry: (err: unknown) => boolean }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= opts.attempts || !opts.shouldRetry(err)) break;
      const delay = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      await sleep(jitterMs(delay));
    }
  }
  throw lastError;
}

