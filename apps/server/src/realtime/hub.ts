import type { RealtimeEvent } from '@family-messenger/protocol';
type SocketLike={readyState:number;send(data:string):void};
export class RealtimeHub{
  private readonly families=new Map<string,Set<SocketLike>>();
  register(familyId:string,connection:SocketLike){let set=this.families.get(familyId);if(!set){set=new Set();this.families.set(familyId,set);}set.add(connection);return()=>{set!.delete(connection);if(set!.size===0)this.families.delete(familyId);};}
  publish(familyId:string,event:RealtimeEvent){const data=JSON.stringify(event);for(const socket of this.families.get(familyId)??[]){if(socket.readyState===1)socket.send(data);}}
}
