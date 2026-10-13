// Tiny TTL cache: concurrent callers share one in-flight request, and a failed refresh
// keeps serving the last good value (marked stale) so a flaky API doesn't blank the screen.
export function cached(ttlMs, load) {
  let value;
  let fetchedAt = 0;
  let inflight = null;

  return async function get() {
    if (value !== undefined && Date.now() - fetchedAt < ttlMs) return value;
    if (!inflight) {
      inflight = load()
        .then((v) => {
          value = v;
          fetchedAt = Date.now();
          return v;
        })
        .finally(() => {
          inflight = null;
        });
    }
    try {
      return await inflight;
    } catch (err) {
      if (value !== undefined) return { ...value, stale: true, error: err.message };
      throw err;
    }
  };
}

export async function fetchWithTimeout(url, { timeoutMs = 10000, ...opts } = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res;
}
