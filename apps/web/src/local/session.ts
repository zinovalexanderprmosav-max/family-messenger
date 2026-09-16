import { getDb, type LocalProfile } from './db.js';
let unlockedPin:string|undefined;
export function setUnlockedPin(pin:string|undefined){unlockedPin=pin;}
export function getUnlockedPin(){return unlockedPin;}
export async function saveProfile(profile:LocalProfile){const db=await getDb();await db.put('profile',{id:'current',profile});}
export async function loadProfile(){const db=await getDb();return (await db.get('profile','current'))?.profile??null;}
