import type { RequestHandler } from 'express';

type RateLimitOptions = {
  limit: number;
  windowMs: number;
  message: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export function createRateLimiter({ limit, windowMs, message }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let requests = 0;

  return (request, response, next) => {
    const now = Date.now();
    const client = request.ip || request.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(client);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(client, bucket);
    }

    response.setHeader('RateLimit-Limit', String(limit));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, limit - bucket.count - 1)));
    response.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count >= limit) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      response.status(429).json({ error: message });
      return;
    }

    bucket.count += 1;
    requests += 1;
    if (requests % 100 === 0) {
      for (const [key, value] of buckets) {
        if (now >= value.resetAt) buckets.delete(key);
      }
    }
    next();
  };
}
