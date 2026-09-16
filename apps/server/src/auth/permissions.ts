export type FamilyRole='owner'|'admin'|'member';

type PermissionInput={
  actorRole:FamilyRole;
  actorMemberId:string;
  targetRole:FamilyRole;
  targetMemberId:string;
};

export function isAdministrator(role:FamilyRole){
  return role==='owner'||role==='admin';
}

export function canManageMember(input:PermissionInput){
  if(input.targetRole==='owner') return false;
  if(input.actorRole==='owner') return input.actorMemberId!==input.targetMemberId;
  if(input.actorRole==='admin') return input.targetRole==='member'&&input.actorMemberId!==input.targetMemberId;
  return false;
}

export function canManageDevice(input:PermissionInput){
  if(input.actorRole==='owner') return true;
  if(input.actorMemberId===input.targetMemberId) return true;
  if(input.actorRole==='admin') return input.targetRole==='member';
  return false;
}
