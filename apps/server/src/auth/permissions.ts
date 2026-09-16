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

export function requireAdministrator(input:{role:FamilyRole}){
  if(!isAdministrator(input.role)) throw Object.assign(new Error('administrator_required'),{statusCode:403});
}

export function requireOwner(input:{role:FamilyRole}){
  if(input.role!=='owner') throw Object.assign(new Error('owner_required'),{statusCode:403});
}
