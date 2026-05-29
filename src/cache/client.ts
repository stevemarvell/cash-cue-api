import { Redis } from 'ioredis';

let _redis: Redis | null = null;

export function getRedis(url?: string): Redis {
  if (_redis) return _redis;
  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  _redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
  return _redis;
}

export async function closeRedis() {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
