import { fromBase64,generateConversationKey,openConversationKey,sealConversationKey } from '@family-messenger/crypto';
import { api } from '../api/client.js';
import { saveChatKey,unlockDeviceProfile } from '../local/keystore.js';

export type RotationRecipientDevice={deviceId:string;memberId:string;encryptionPublicKey:string};
export type PendingRotation={
  chatId:string;
  fromKeyVersion:number;
  toKeyVersion:number;
  reason:'device_revoked'|'member_removed';
  recipientDevices:RotationRecipientDevice[];
};

async function restoreCurrentKey(chatId:string,pin:string){
  const envelope=await api<{keyVersion:number;sealedKeyEnvelope:string}>(`/v1/keys/chat/${chatId}/current`);
  const identity=await unlockDeviceProfile(pin);
  const key=await openConversationKey(
    envelope.sealedKeyEnvelope,
    fromBase64(identity.encryptionPublicKey),
    fromBase64(identity.encryptionPrivateKey)
  );
  await saveChatKey(chatId,envelope.keyVersion,key,pin);
  return {chatId,keyVersion:envelope.keyVersion};
}

async function rotateOne(item:PendingRotation,pin:string){
  const key=await generateConversationKey();
  const envelopes=await Promise.all(item.recipientDevices.map(async device=>({
    deviceId:device.deviceId,
    sealedKeyEnvelope:await sealConversationKey(key,fromBase64(device.encryptionPublicKey))
  })));

  try{
    await api<{chatId:string;keyVersion:number}>(`/v1/chats/${item.chatId}/key-rotation`,{
      method:'POST',
      body:JSON.stringify({toKeyVersion:item.toKeyVersion,envelopes})
    });
    await saveChatKey(item.chatId,item.toKeyVersion,key,pin);
    return {chatId:item.chatId,keyVersion:item.toKeyVersion};
  }catch(error){
    if(error instanceof Error&&[
      'key_rotation_already_completed',
      'key_rotation_not_found',
      'key_rotation_state_conflict'
    ].includes(error.message)){
      return restoreCurrentKey(item.chatId,pin);
    }
    throw error;
  }
}

export async function processPendingRotations(pin:string){
  const response=await api<{items:PendingRotation[]}>('/v1/key-rotations');
  const completed:Array<{chatId:string;keyVersion:number}>=[];
  for(const item of response.items){
    completed.push(await rotateOne(item,pin));
  }
  return completed;
}
