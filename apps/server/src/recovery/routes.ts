import {createHash} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {DatabasePool} from '../db/pool.js';
import {requireSession} from '../auth/session.js';
import {requireCsrf} from '../auth/csrf.js';

const RecoveryCode=z.string().trim().transform(value=>value.replace(/[^A-Fa-f0-9]/g,'').toUpperCase())
  .refine(value=>/^[A-F0-9]{32}$/.test(value),'recovery_code_invalid');

const EncryptedKeystore=z.object({
  version:z.literal(1),
  kdf:z.literal('argon2id13'),
  salt:z.string().min(1),
  opslimit:z.literal(3),
  memlimitBytes:z.literal(67108864),
  nonce:z.string().min(1),
  ciphertext:z.string().min(1)
});

const BackupRequest=z.object({
  recoveryCode:RecoveryCode,
  encryptedKeystore:EncryptedKeystore
});
const RestoreRequest=z.object({recoveryCode:RecoveryCode});

function tokenHash(code:string){
  return createHash('sha256').update(code,'utf8').digest('hex');
}

export async function registerRecoveryBackupRoutes(app:FastifyInstance,pool:DatabasePool){
  app.post('/v1/recovery/backup',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    requireCsrf(request,principal);
    if(principal.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const input=BackupRequest.parse(request.body);
    await pool.query(`
      INSERT INTO device_recovery_backups(device_id,recovery_token_hash,encrypted_keystore,updated_at)
      VALUES($1,$2,$3::jsonb,now())
      ON CONFLICT(device_id)
      DO UPDATE SET
        recovery_token_hash=EXCLUDED.recovery_token_hash,
        encrypted_keystore=EXCLUDED.encrypted_keystore,
        updated_at=now()
    `,[principal.deviceId,tokenHash(input.recoveryCode),JSON.stringify(input.encryptedKeystore)]);
    return reply.code(204).send();
  });

  app.post('/v1/recovery/restore',async(request,reply)=>{
    const input=RestoreRequest.parse(request.body);
    const r=await pool.query<{
      device_id:string;
      encrypted_keystore:unknown;
      status:string;
    }>(`
      SELECT b.device_id,b.encrypted_keystore,d.status
      FROM device_recovery_backups b
      JOIN devices d ON d.id=b.device_id
      WHERE b.recovery_token_hash=$1
      LIMIT 1
    `,[tokenHash(input.recoveryCode)]);
    const row=r.rows[0];
    if(!row||row.status==='revoked')return reply.code(404).send({error:'recovery_backup_not_found'});
    const encryptedKeystore=EncryptedKeystore.parse(row.encrypted_keystore);
    return {deviceId:row.device_id,encryptedKeystore};
  });
}
