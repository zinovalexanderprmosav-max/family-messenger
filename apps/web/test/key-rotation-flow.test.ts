// @vitest-environment node
import {expect,it} from 'vitest';
import {fromBase64,generateConversationKey,generateDeviceIdentity,openConversationKey,sealConversationKey,toBase64} from '@family-messenger/crypto';
import {rotateChatKeyCore} from '../src/flows/key-rotation-core.js';

it('seals the same fresh key to every recipient without plaintext key in the request',async()=>{
  const first=await generateDeviceIdentity(),second=await generateDeviceIdentity();
  let request:any;
  const result=await rotateChatKeyCore('chat',{
    getStatus:async()=>({status:'required',chatId:'00000000-0000-4000-8000-000000000001',fromKeyVersion:5,nextKeyVersion:6,devices:[
      {deviceId:'00000000-0000-4000-8000-000000000011',memberId:'00000000-0000-4000-8000-000000000021',encryptionPublicKey:toBase64(first.encryptionPublicKey)},
      {deviceId:'00000000-0000-4000-8000-000000000012',memberId:'00000000-0000-4000-8000-000000000022',encryptionPublicKey:toBase64(second.encryptionPublicKey)}
    ]}),
    generateKey:generateConversationKey,
    sealKey:(key,publicKey)=>sealConversationKey(key,fromBase64(publicKey)),
    submit:async(_chatId,body)=>{request=body;},
    save:async()=>{},
    currentVersion:async()=>5
  });
  expect(result.keyVersion).toBe(6);
  expect(Object.keys(request).sort()).toEqual(['envelopes','fromKeyVersion','nextKeyVersion']);
  expect(JSON.stringify(request)).not.toContain('plaintext');
  const a=await openConversationKey(request.envelopes[0].sealedKeyEnvelope,first.encryptionPublicKey,first.encryptionPrivateKey);
  const b=await openConversationKey(request.envelopes[1].sealedKeyEnvelope,second.encryptionPublicKey,second.encryptionPrivateKey);
  expect(Array.from(a)).toEqual(Array.from(b));expect(a).toHaveLength(32);
});
