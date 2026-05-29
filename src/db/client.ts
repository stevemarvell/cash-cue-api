import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(url?: string) {
  if (_db) return _db;
  const connectionUrl = url ?? process.env.DATABASE_URL!;
  _sql = postgres(connectionUrl);
  _db = drizzle(_sql, { schema });
  return _db;
}

export type Db = ReturnType<typeof getDb>;

export async function closeDb() {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _db = null;
  }
}
