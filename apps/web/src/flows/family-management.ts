import {api} from '../api/client.js';

export async function removeFamilyMember(memberId:string){
  await api<void>(`/v1/family/members/${encodeURIComponent(memberId)}/remove`,{method:'POST',body:'{}'});
}

export async function promoteFamilyAdministrator(memberId:string){
  await api<void>(`/v1/family/admins/${encodeURIComponent(memberId)}/promote`,{method:'POST',body:'{}'});
}

export async function demoteFamilyAdministrator(memberId:string){
  await api<void>(`/v1/family/admins/${encodeURIComponent(memberId)}/demote`,{method:'POST',body:'{}'});
}
