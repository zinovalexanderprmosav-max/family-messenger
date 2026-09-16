import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DatabasePool } from './pool.js';

export async function migrate(pool: DatabasePool) {
  const path = fileURLToPath(new URL('./migrations/001_core.sql', import.meta.url));
  const sql = await readFile(path, 'utf8');
  await pool.query(sql);
}
