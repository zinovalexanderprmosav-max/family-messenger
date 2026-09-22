import {signDetached,toBase64,fromBase64,utf8} from '@family-messenger/crypto';
import {hasLocalEncryptedKeystore,unlockDeviceProfile} from '../local/keystore.js';
import {saveProfile,setUnlockedPin} from '../local/session.js';

type IdentifyResponse={deviceId:string};
type ChallengeResponse={challengeId:string;challenge:string;expiresInSeconds:number};
type CompleteResponse={csrfToken:string;memberId:string;familyId:string;deviceId:string};
type SessionContext={
  familyId:string;memberId:string;deviceId:string;familyChatId:string;
  status:'pending_key'|'active';csrfToken:string;
  familyDisplayName:string;memberDisplayName:string;deviceName:string;
};

async function postJson<T>(path:string,body:unknown):Promise<T>{
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

function authChallengeBytes(input:{challengeId:string;deviceId:string;challenge:string}){
  return utf8(`family-messenger:auth:v1|${input.challengeId}|${input.deviceId}|${input.challenge}`);
}

export async function canRecoverExistingDevice(){
  return hasLocalEncryptedKeystore();
}

export async function recoverExistingDeviceWithPin(pin:string){
  if(!await hasLocalEncryptedKeystore())throw new Error('recovery_keystore_not_found');

  const plain=await unlockDeviceProfile(pin);
  const identify=await postJson<IdentifyResponse>('/v1/auth/identify',{
    signingPublicKey:plain.signingPublicKey
  });
  const challenge=await postJson<ChallengeResponse>('/v1/auth/challenge',{deviceId:identify.deviceId});
  const signature=await signDetached(
    authChallengeBytes({
      challengeId:challenge.challengeId,
      deviceId:identify.deviceId,
      challenge:challenge.challenge
    }),
    fromBase64(plain.signingPrivateKey)
  );
  await postJson<CompleteResponse>('/v1/auth/complete',{
    challengeId:challenge.challengeId,
    deviceId:identify.deviceId,
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
