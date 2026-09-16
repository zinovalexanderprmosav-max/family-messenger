export function consumeDeviceLinkTokenFromHash(
  _locationLike:Pick<Location,'hash'>,
  _historyLike:Pick<History,'replaceState'>
){
  return null;
}

export async function acceptDeviceLink(_input:{
  linkToken:string;
  deviceName:string;
  pin:string;
  memberDisplayName:string;
  familyDisplayName?:string;
}){
  return null;
}
