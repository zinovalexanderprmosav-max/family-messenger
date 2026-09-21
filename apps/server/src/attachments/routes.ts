import type {FastifyInstance} from 'fastify';
import {EncryptedAttachmentSchema,Id} from '@family-messenger/protocol';
import type {DatabasePool} from '../db/pool.js';
import {requireSession} from '../auth/session.js';
import {requireCsrf} from '../auth/csrf.js';
import {assertActiveActor,fail,lockFamily} from '../families/access.js';
import {getAttachment,insertAttachment} from './repository.js';

const MAX_ATTACHMENT_BYTES=25*1024*1024;

export async function registerAttachmentRoutes(app:FastifyInstance,pool:DatabasePool){
  app.post<{Params:{chatId:string}}>('/v1/chats/:chatId/attachments',{bodyLimit:36*1024*1024},async(request,reply)=>{
    const principal=await requireSession(request,pool);
    requireCsrf(request,principal);
    if(principal.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const envelope=EncryptedAttachmentSchema.parse(request.body);
    if(envelope.chatId!==request.params.chatId)return reply.code(400).send({error:'attachment_chat_mismatch'});
    const ciphertextBytes=Buffer.from(envelope.ciphertext,'base64').byteLength;
    if(ciphertextBytes<=0||ciphertextBytes>MAX_ATTACHMENT_BYTES)return reply.code(413).send({error:'attachment_too_large'});

    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await lockFamily(tx,principal.familyId);
      await assertActiveActor(tx,principal);
      const chat=(await tx.query<{write_disabled_at:Date|null}>(`
        SELECT c.write_disabled_at
        FROM chats c
        JOIN chat_members cm ON cm.chat_id=c.id AND cm.member_id=$3
        JOIN family_memberships fm ON fm.family_id=c.family_id AND fm.member_id=cm.member_id AND fm.status='active'
        WHERE c.id=$1 AND c.family_id=$2
        FOR UPDATE OF c
      `,[envelope.chatId,principal.familyId,principal.memberId])).rows[0];
      if(!chat)fail('chat_not_found',404);
      if(chat.write_disabled_at)fail('chat_read_only',409);
      const pending=await tx.query(`
        SELECT 1 FROM chat_key_rotations WHERE chat_id=$1 AND status='required' LIMIT 1
      `,[envelope.chatId]);
      if(pending.rowCount)fail('key_rotation_required',409);
      const stored=await insertAttachment(tx,{...envelope,uploaderDeviceId:principal.deviceId,ciphertextBytes});
      await tx.query('COMMIT');
      return reply.code(stored.inserted?201:200).send({
        attachmentId:envelope.attachmentId,chatId:envelope.chatId,ciphertextBytes
      });
    }catch(error){await tx.query('ROLLBACK');throw error;}
    finally{tx.release();}
  });

  app.get<{Params:{attachmentId:string}}>('/v1/attachments/:attachmentId',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    if(principal.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const attachmentId=Id.parse(request.params.attachmentId);
    const tx=await pool.connect();
    try{
      const item=await getAttachment(tx,{attachmentId,familyId:principal.familyId,memberId:principal.memberId});
      if(!item)return reply.code(404).send({error:'attachment_not_found'});
      return item;
    }finally{tx.release();}
  });
}
