import type {LocalProfile} from '../local/db.js';
import {hasLocalEncryptedKeystore} from '../local/keystore.js';
import {saveProfile} from '../local/session.js';

type SessionContext={
  familyId:string;
  memberId:string;
  deviceId:string;
  familyChatId:string;
  status:'pending_key'|'active';
  csrfToken:string;
  familyDisplayName:string;
  memberDisplayName:string;
  deviceName:string;
};

export type SessionRecoveryResult=
  |{status:'restored';profile:LocalProfile}
  |{status:'keys_missing';context:SessionContext}
  |{status:'no_session'};

export async function recoverProfileFromServerSession():Promise<SessionRecoveryResult>{
  let response:Response;
  try{
    response=await fetch('/v1/session/context',{
      method:'GET',
      credentials:'same-origin',
      headers:{accept:'application/json'},
      cache:'no-store'
    });
  }catch{
    return {status:'no_session'};
  }

  if(response.status===401||response.status===403||response.status===404)return {status:'no_session'};
  if(!response.ok)return {status:'no_session'};

  const context=await response.json() as SessionContext;
  const hasKeystore=await hasLocalEncryptedKeystore();
  if(!hasKeystore)return {status:'keys_missing',context};

  const profile:LocalProfile={
    familyId:context.familyId,
    memberId:context.memberId,
    deviceId:context.deviceId,
    familyChatId:context.familyChatId,
    status:context.status,
    csrfToken:context.csrfToken,
    memberDisplayName:context.memberDisplayName,
    familyDisplayName:context.familyDisplayName
  };
  await saveProfile(profile);
  return {status:'restored',profile};
}
