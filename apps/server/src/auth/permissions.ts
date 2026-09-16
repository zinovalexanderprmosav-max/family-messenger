export type FamilyRole='owner'|'admin'|'member';

type PermissionInput={
  actorRole:FamilyRole;
  actorMemberId:string;
  targetRole:FamilyRole;
  targetMemberId:string;
};

export function isAdministrator(_role:FamilyRole){
  return false;
}

export function canManageMember(_input:PermissionInput){
  return false;
}

export function canManageDevice(_input:PermissionInput){
  return false;
}
