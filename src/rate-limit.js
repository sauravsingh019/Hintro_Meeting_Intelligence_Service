const buckets = new Map();

export function createRateLimiter({ windowMs = 60_000, maxRequests = 120 } = {}) {
  return function rateLimit(key) {
    const now = Date.now();
    const bucket = buckets.get(key) ?? [];
    const recent = bucket.filter((timestamp) => now - timestamp < windowMs);
    recent.push(now);
    buckets.set(key, recent);
    return {
      allowed: recent.length <= maxRequests,
      retryAfterMs: recent.length <= maxRequests ? 0 : windowMs - (now - recent[0]),
      current: recent.length,
    };
  };
}
