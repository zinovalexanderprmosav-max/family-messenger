import {api} from '../api/client.js';
import type {ManagedDevice} from '../api/types.js';

export async function listManagedDevices(){
  return (await api<{items:ManagedDevice[]}>('/v1/family/devices')).items;
}

export async function revokeManagedDevice(deviceId:string){
  await api<void>(`/v1/family/devices/${encodeURIComponent(deviceId)}/revoke`,{method:'POST',body:'{}'});
}

export async function renameManagedDevice(deviceId:string,deviceName:string){
  await api<void>(`/v1/family/devices/${encodeURIComponent(deviceId)}/rename`,{method:'POST',body:JSON.stringify({deviceName})});
}
