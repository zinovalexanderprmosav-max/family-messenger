import type { DeviceLinkInspection } from '../flows/device-link.js';

export function AcceptDeviceLinkForm(_props:{
  inspection:DeviceLinkInspection;
  busy:boolean;
  error:string;
  onSubmit:(deviceName:string,pin:string)=>void;
}){
  return <section/>;
}
