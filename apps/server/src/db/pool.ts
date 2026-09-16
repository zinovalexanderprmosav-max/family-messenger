import pg from 'pg';
const { Pool } = pg;
export type { PoolClient } from 'pg';
export function createPool(databaseUrl: string) {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}
export type DatabasePool = ReturnType<typeof createPool>;
