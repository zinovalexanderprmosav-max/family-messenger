import {
  decryptKeystore,
  fromBase64,
  signDetached,
  toBase64,
  utf8,
  type EncryptedKeystoreBlob
} from '@family-messenger/crypto';
import {api} from '../api/client.js';
import {loadEncryptedKeystoreBlob,saveEncryptedKeystoreBlob} from '../local/keystore.js';
import {loadRecoveryCode,saveRecoveryCode} from '../local/shadow.js';
import {loadProfile,saveProfile,setUnlockedPin} from '../local/session.js';

type RestoreResponse={deviceId:string;encryptedKeystore:EncryptedKeystoreBlob};
type ChallengeResponse={challengeId:string;challenge:string;expiresInSeconds:number};
type SessionContext={
  familyId:string;memberId:string;deviceId:string;familyChatId:string;
  status:'pending_key'|'active';csrfToken:string;
  familyDisplayName:string;memberDisplayName:string;deviceName:string;
};

function normalized(code:string){
  return code.replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
}

export function formatRecoveryCode(code:string){
  const value=normalized(code);
  return value.match(/.{1,4}/g)?.join('-')??value;
}

export function createRecoveryCode(){
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return formatRecoveryCode(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase());
}

export function getSavedRecoveryCode(){
  const code=loadRecoveryCode();
  return code?formatRecoveryCode(code):null;
}

export async function syncRecoveryBackupBlob(blob:EncryptedKeystoreBlob){
  const code=getSavedRecoveryCode();
  if(!code)return false;
  const profile=await loadProfile();
  if(!profile||profile.status!=='active')return false;
  await api<void>('/v1/recovery/backup',{
    method:'POST',
    body:JSON.stringify({recoveryCode:code,encryptedKeystore:blob})
  });
  return true;
}

export async function ensureRecoveryBackup(){
  let code=getSavedRecoveryCode();
  if(!code){
    code=createRecoveryCode();
    saveRecoveryCode(code);
  }
  const blob=await loadEncryptedKeystoreBlob();
  if(!blob)throw new Error('keystore_not_found');
  await syncRecoveryBackupBlob(blob);
  return code;
}

async function postJson<T>(path:string,body:unknown){
  const response=await fetch(path,{
    method:'POST',
    credentials:'same-origin',
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify(body)
  });
  if(!response.ok){
    const payload=await response.json().catch(()=>({error:`http_${response.status}`})) as {error?:string};
    throw new Error(payload.error??`http_${response.status}`);
  }
  return response.json() as Promise<T>;
}

function challengeBytes(input:{challengeId:string;deviceId:string;challenge:string}){
  return utf8(`family-messenger:auth:v1|${input.challengeId}|${input.deviceId}|${input.challenge}`);
}

export async function restoreFromRecoveryBackup(recoveryCode:string,pin:string){
  const code=formatRecoveryCode(recoveryCode);
  if(normalized(code).length!==32)throw new Error('recovery_code_invalid');

  const restored=await postJson<RestoreResponse>('/v1/recovery/restore',{recoveryCode:code});
  const plain=await decryptKeystore(restored.encryptedKeystore,pin);

  const challenge=await postJson<ChallengeResponse>('/v1/auth/challenge',{deviceId:restored.deviceId});
  const signature=await signDetached(
    challengeBytes({
      challengeId:challenge.challengeId,
      deviceId:restored.deviceId,
      challenge:challenge.challenge
    }),
    fromBase64(plain.signingPrivateKey)
  );
  await postJson('/v1/auth/complete',{
    challengeId:challenge.challengeId,
    deviceId:restored.deviceId,
    signature:toBase64(signature)
  });

  const response=await fetch('/v1/session/context',{
    method:'GET',
    credentials:'same-origin',
    headers:{accept:'application/json'},
    cache:'no-store'
  });
  if(!response.ok){
    const payload=await response.json().catch(()=>({error:`http_${response.status}`})) as {error?:string};
    throw new Error(payload.error??`http_${response.status}`);
  }
  const context=await response.json() as SessionContext;

  await saveEncryptedKeystoreBlob(restored.encryptedKeystore);
  saveRecoveryCode(code);
  await saveProfile({
    familyId:context.familyId,
    memberId:context.memberId,
    deviceId:context.deviceId,
    familyChatId:context.familyChatId,
    status:context.status,
    csrfToken:context.csrfToken,
    memberDisplayName:context.memberDisplayName,
    familyDisplayName:context.familyDisplayName
  });
  setUnlockedPin(pin);
  return context;
}
