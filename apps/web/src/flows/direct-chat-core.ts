export type DirectChatReady={status:'ready';chatId:string;keyVersion:number;sealedKeyEnvelope?:string};
export type DirectChatDevice={deviceId:string;memberId:string;encryptionPublicKey:string};
export type DirectChatPreparation=DirectChatReady|{status:'needs_key';devices:DirectChatDevice[]};
export type DirectChatEnvelope={deviceId:string;sealedKeyEnvelope:string};
export type ConversationMaterial={key:Uint8Array;envelopes:DirectChatEnvelope[]};

export type DirectChatDependencies={
  prepare(memberId:string):Promise<DirectChatPreparation>;
  localKeyExists(chatId:string):Promise<boolean>;
  restoreExistingKey(ready:DirectChatReady):Promise<void>;
  createConversationMaterial(devices:DirectChatDevice[]):Promise<ConversationMaterial>;
  createRemote(memberId:string,envelopes:DirectChatEnvelope[]):Promise<DirectChatReady>;
  saveCreatedKey(chatId:string,keyVersion:number,key:Uint8Array):Promise<void>;
};

export async function ensureDirectChat(memberId:string,deps:DirectChatDependencies):Promise<{chatId:string;keyVersion:number}>{
  const prepared=await deps.prepare(memberId);
  if(prepared.status==='ready'){
    if(await deps.localKeyExists(prepared.chatId))return {chatId:prepared.chatId,keyVersion:prepared.keyVersion};
    await deps.restoreExistingKey(prepared);
    return {chatId:prepared.chatId,keyVersion:prepared.keyVersion};
  }
  const material=await deps.createConversationMaterial(prepared.devices);
  const ready=await deps.createRemote(memberId,material.envelopes);
  await deps.saveCreatedKey(ready.chatId,ready.keyVersion,material.key);
  return {chatId:ready.chatId,keyVersion:ready.keyVersion};
}
