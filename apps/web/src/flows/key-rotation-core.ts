import type {CompleteKeyRotationRequest,KeyRotationStatusResponse} from '@family-messenger/protocol';

export type KeyRotationCoreDeps={
  getStatus:(chatId:string)=>Promise<KeyRotationStatusResponse>;
  generateKey:()=>Promise<Uint8Array>;
  sealKey:(key:Uint8Array,encryptionPublicKey:string)=>Promise<string>;
  submit:(chatId:string,request:CompleteKeyRotationRequest)=>Promise<void>;
  save:(chatId:string,keyVersion:number,key:Uint8Array)=>Promise<void>;
  currentVersion:(chatId:string)=>Promise<number>;
};

export async function rotateChatKeyCore(chatId:string,deps:KeyRotationCoreDeps){
  const status=await deps.getStatus(chatId);
  if(status.status==='not_required')return {keyVersion:await deps.currentVersion(chatId),rotated:false as const};
  const key=await deps.generateKey();
  const envelopes=await Promise.all(status.devices.map(async device=>({
    deviceId:device.deviceId,
    sealedKeyEnvelope:await deps.sealKey(key,device.encryptionPublicKey)
  })));
  const request:CompleteKeyRotationRequest={
    fromKeyVersion:status.fromKeyVersion,
    nextKeyVersion:status.nextKeyVersion,
    envelopes
  };
  await deps.submit(chatId,request);
  await deps.save(chatId,status.nextKeyVersion,key);
  return {keyVersion:status.nextKeyVersion,rotated:true as const};
}
