import { getDb, type LocalProfile } from './db.js';

declare global {
  interface Window {
    FamilyMessengerNative?: {
      getAutoPin?:()=>string;
      getDeviceName?:()=>string;
    };
  }
}

let unlockedPin:string|undefined;

function nativePin(){
  try{
    const value=window.FamilyMessengerNative?.getAutoPin?.();
    return typeof value==='string'&&/^\d{12,}$/.test(value)?value:undefined;
  }catch{return undefined;}
}

export function setUnlockedPin(pin:string|undefined){unlockedPin=pin;}
export function getUnlockedPin(){unlockedPin??=nativePin();return unlockedPin;}
export function getNativeDeviceName(){
  try{
    const value=window.FamilyMessengerNative?.getDeviceName?.();
    return typeof value==='string'&&value.trim()?value.trim():undefined;
  }catch{return undefined;}
}
export function isNativeAndroid(){return Boolean(window.FamilyMessengerNative?.getAutoPin);}
export async function saveProfile(profile:LocalProfile){const db=await getDb();await db.put('profile',{id:'current',profile});}
export async function loadProfile(){const db=await getDb();return (await db.get('profile','current'))?.profile??null;}
