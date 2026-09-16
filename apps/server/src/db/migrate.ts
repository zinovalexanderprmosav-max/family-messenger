import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DatabasePool } from './pool.js';

const MIGRATIONS=[
  '001_core.sql',
  '002_phase3_identity_chats_devices.sql'
] as const;

export async function migrate(pool: DatabasePool) {
  for(const file of MIGRATIONS){
    const path=fileURLToPath(new URL(`./migrations/${file}`,import.meta.url));
    const sql=await readFile(path,'utf8');
    await pool.query(sql);
  }
}
