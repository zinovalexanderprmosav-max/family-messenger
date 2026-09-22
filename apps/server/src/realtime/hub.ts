import type {RealtimeEvent} from '@family-messenger/protocol';
type SocketLike={readyState:number;send(data:string):void;close(code:number,reason:string):void};
export class RealtimeHub{
 private readonly connections=new Set<{familyId:string;deviceId:string;socket:SocketLike}>();
 register(owner:{familyId:string;deviceId:string},socket:SocketLike){const entry={...owner,socket};this.connections.add(entry);return()=>{this.connections.delete(entry);};}
 publish(familyId:string,event:RealtimeEvent){const data=JSON.stringify(event);for(const c of this.connections){if(c.familyId===familyId&&c.socket.readyState===1)c.socket.send(data);}}
 disconnectDevice(deviceId:string,code=1008,reason='revoked'){for(const c of this.connections){if(c.deviceId===deviceId){this.connections.delete(c);c.socket.close(code,reason);}}}
}
