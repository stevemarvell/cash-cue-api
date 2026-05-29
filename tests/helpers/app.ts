import { buildApp } from '../../src/app.js';
import { MemoryCacheService } from '../../src/cache/cache.js';
import type { Db } from '../../src/db/client.js';

// Minimal in-memory DB stub — routes that call db methods need explicit mocking per test
export function buildTestApp(db?: Partial<Db>) {
  return buildApp({
    db: db as Db,
    cache: new MemoryCacheService(),
    logger: false,
  });
}
