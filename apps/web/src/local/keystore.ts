import { decryptKeystore, encryptKeystore, fromBase64, toBase64, type DeviceIdentity, type EncryptedKeystoreBlob, type PlainKeystore } from '@family-messenger/crypto';
import { getDb } from './db.js';
import { loadKeystoreShadow, saveKeystoreShadow } from './shadow.js';

export function identityToPlain(identity:DeviceIdentity):PlainKeystore{return {encryptionPublicKey:toBase64(identity.encryptionPublicKey),encryptionPrivateKey:toBase64(identity.encryptionPrivateKey),signingPublicKey:toBase64(identity.signingPublicKey),signingPrivateKey:toBase64(identity.signingPrivateKey),chatKeys:{}};}

export async function savePlainKeystore(plain:PlainKeystore,pin:string){
  const blob=await encryptKeystore(plain,pin);
  const db=await getDb();
  await db.put('keystore',{id:'device',blob});
  saveKeystoreShadow(blob);
}

export async function createLockedDeviceProfile(identity:DeviceIdentity,pin:string){await savePlainKeystore(identityToPlain(identity),pin);}

async function loadEncryptedKeystore(){
  const db=await getDb();
  const row=await db.get('keystore','device');
  if(row){
    saveKeystoreShadow(row.blob);
    return row.blob;
  }
  const shadow=loadKeystoreShadow<EncryptedKeystoreBlob>();
  if(!shadow)return null;
  await db.put('keystore',{id:'device',blob:shadow});
  return shadow;
}

export async function hasLocalEncryptedKeystore(){
  const db=await getDb();
  const row=await db.get('keystore','device');
  if(row){
    saveKeystoreShadow(row.blob);
    return true;
  }
  return Boolean(loadKeystoreShadow<EncryptedKeystoreBlob>());
}

export async function unlockDeviceProfile(pin:string){
  const blob=await loadEncryptedKeystore();
  if(!blob)throw new Error('keystore_not_found');
  return decryptKeystore(blob,pin);
}

export async function saveChatKey(chatId:string,keyVersion:number,key:Uint8Array,pin:string){
 const plain=await unlockDeviceProfile(pin),encoded=toBase64(key),current=plain.chatKeys[chatId];
 if(!current){plain.chatKeys[chatId]={keyVersion,key:encoded};}
 else if(keyVersion>current.keyVersion){plain.chatKeys[chatId]={keyVersion,key:encoded,previous:{...(current.previous??{}),[String(current.keyVersion)]:current.key}};}
 else if(keyVersion===current.keyVersion){plain.chatKeys[chatId]={...current,key:encoded};}
 else{plain.chatKeys[chatId]={...current,previous:{...(current.previous??{}),[String(keyVersion)]:encoded}};}
 await savePlainKeystore(plain,pin);
}
export async function loadChatKey(chatId:string,pin:string,keyVersion?:number){
 const plain=await unlockDeviceProfile(pin),item=plain.chatKeys[chatId];if(!item)throw new Error('chat_key_not_found');
 if(keyVersion===undefined||keyVersion===item.keyVersion)return {keyVersion:item.keyVersion,key:fromBase64(item.key)};
 const historical=item.previous?.[String(keyVersion)];if(!historical)throw new Error('chat_key_not_found');return {keyVersion,key:fromBase64(historical)};
}

export async function listStoredChatKeys(pin:string){
 const plain=await unlockDeviceProfile(pin);
 const items:Array<{chatId:string;keyVersion:number;key:Uint8Array}>=[];
 for(const [chatId,current] of Object.entries(plain.chatKeys)){
  for(const [version,key] of Object.entries(current.previous??{}))items.push({chatId,keyVersion:Number(version),key:fromBase64(key)});
  items.push({chatId,keyVersion:current.keyVersion,key:fromBase64(current.key)});
 }
 items.sort((a,b)=>a.chatId.localeCompare(b.chatId)||a.keyVersion-b.keyVersion);
 return items;
}
