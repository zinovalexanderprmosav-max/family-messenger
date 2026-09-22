const PROFILE_KEY='family-messenger:profile-shadow:v1';
const KEYSTORE_KEY='family-messenger:keystore-shadow:v1';
const RECOVERY_CODE_KEY='family-messenger:recovery-code:v1';

function storage(){
  try{
    if(typeof localStorage==='undefined')return null;
    return localStorage;
  }catch{return null;}
}

export function saveProfileShadow(value:unknown){
  try{storage()?.setItem(PROFILE_KEY,JSON.stringify(value));}catch{}
}
export function loadProfileShadow<T>():T|null{
  try{
    const raw=storage()?.getItem(PROFILE_KEY);
    return raw?JSON.parse(raw) as T:null;
  }catch{return null;}
}
export function saveKeystoreShadow(value:unknown){
  try{storage()?.setItem(KEYSTORE_KEY,JSON.stringify(value));}catch{}
}
export function loadKeystoreShadow<T>():T|null{
  try{
    const raw=storage()?.getItem(KEYSTORE_KEY);
    return raw?JSON.parse(raw) as T:null;
  }catch{return null;}
}
export function saveRecoveryCode(value:string){
  try{storage()?.setItem(RECOVERY_CODE_KEY,value);}catch{}
}
export function loadRecoveryCode(){
  try{return storage()?.getItem(RECOVERY_CODE_KEY)??null;}catch{return null;}
}
export function clearRecoveryCode(){
  try{storage()?.removeItem(RECOVERY_CODE_KEY);}catch{}
}
export function clearLocalShadows(){
  try{
    const target=storage();
    target?.removeItem(PROFILE_KEY);
    target?.removeItem(KEYSTORE_KEY);
    target?.removeItem(RECOVERY_CODE_KEY);
  }catch{}
}
