import { generateConversationKey, generateDeviceIdentity, sealConversationKey, toBase64 } from '@family-messenger/crypto';
import { api } from '../api/client.js';
import type { BootstrapResponse } from '../api/types.js';
import { identityToPlain, savePlainKeystore } from '../local/keystore.js';
import { saveProfile, setUnlockedPin } from '../local/session.js';

export async function bootstrapFamily(input:{familyDisplayName:string;memberDisplayName:string;deviceName:string;pin:string}){
  const identity=await generateDeviceIdentity();
  const chatKey=await generateConversationKey();
  const initialFamilyChatKeyEnvelope=await sealConversationKey(chatKey,identity.encryptionPublicKey);
  const response=await api<BootstrapResponse>('/v1/families/bootstrap',{method:'POST',body:JSON.stringify({
    familyDisplayName:input.familyDisplayName,memberDisplayName:input.memberDisplayName,deviceName:input.deviceName,
    encryptionPublicKey:toBase64(identity.encryptionPublicKey),signingPublicKey:toBase64(identity.signingPublicKey),initialFamilyChatKeyEnvelope
  })});
  const plain=identityToPlain(identity);plain.chatKeys[response.familyChatId]={keyVersion:response.keyVersion,key:toBase64(chatKey)};
  await savePlainKeystore(plain,input.pin);
  await saveProfile({familyId:response.familyId,memberId:response.memberId,deviceId:response.deviceId,familyChatId:response.familyChatId,status:'active',csrfToken:response.csrfToken,memberDisplayName:input.memberDisplayName,familyDisplayName:input.familyDisplayName});
  setUnlockedPin(input.pin);
  return {familyId:response.familyId,memberId:response.memberId,deviceId:response.deviceId,familyChatId:response.familyChatId};
}
