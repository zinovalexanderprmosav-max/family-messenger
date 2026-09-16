import { describe,expect,it } from 'vitest';
import { canManageDevice,canManageMember,isAdministrator } from './permissions.js';

describe('family role permissions',()=>{
  it('treats owner and secondary admin as administrators',()=>{
    expect(isAdministrator('owner')).toBe(true);
    expect(isAdministrator('admin')).toBe(true);
    expect(isAdministrator('member')).toBe(false);
  });

  it('lets owner manage non-owner members while protecting the owner membership',()=>{
    expect(canManageMember({actorRole:'owner',actorMemberId:'o',targetRole:'admin',targetMemberId:'a'})).toBe(true);
    expect(canManageMember({actorRole:'owner',actorMemberId:'o',targetRole:'member',targetMemberId:'m'})).toBe(true);
    expect(canManageMember({actorRole:'owner',actorMemberId:'o',targetRole:'owner',targetMemberId:'o'})).toBe(false);
  });

  it('lets secondary admin manage only ordinary members',()=>{
    expect(canManageMember({actorRole:'admin',actorMemberId:'a',targetRole:'member',targetMemberId:'m'})).toBe(true);
    expect(canManageMember({actorRole:'admin',actorMemberId:'a',targetRole:'owner',targetMemberId:'o'})).toBe(false);
    expect(canManageMember({actorRole:'admin',actorMemberId:'a',targetRole:'admin',targetMemberId:'a'})).toBe(false);
    expect(canManageMember({actorRole:'member',actorMemberId:'m1',targetRole:'member',targetMemberId:'m2'})).toBe(false);
  });

  it('lets users manage devices according to the approved hierarchy',()=>{
    expect(canManageDevice({actorRole:'owner',actorMemberId:'o',targetRole:'owner',targetMemberId:'o'})).toBe(true);
    expect(canManageDevice({actorRole:'owner',actorMemberId:'o',targetRole:'admin',targetMemberId:'a'})).toBe(true);
    expect(canManageDevice({actorRole:'admin',actorMemberId:'a',targetRole:'admin',targetMemberId:'a'})).toBe(true);
    expect(canManageDevice({actorRole:'admin',actorMemberId:'a',targetRole:'member',targetMemberId:'m'})).toBe(true);
    expect(canManageDevice({actorRole:'admin',actorMemberId:'a',targetRole:'owner',targetMemberId:'o'})).toBe(false);
    expect(canManageDevice({actorRole:'member',actorMemberId:'m',targetRole:'member',targetMemberId:'m'})).toBe(true);
    expect(canManageDevice({actorRole:'member',actorMemberId:'m',targetRole:'member',targetMemberId:'other'})).toBe(false);
  });
});
