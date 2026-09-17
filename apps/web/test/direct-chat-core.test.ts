import { describe,expect,it } from 'vitest';
import { ensureDirectChat } from '../src/flows/direct-chat-core.js';

describe('mobile direct chat core',()=>{
  it('opens an existing direct chat when its key is already local',async()=>{
    const calls:string[]=[];
    const result=await ensureDirectChat('member-mama',{
      prepare:async()=>({status:'ready',chatId:'chat-1',keyVersion:1,sealedKeyEnvelope:'sealed'}),
      localKeyExists:async()=>true,
      restoreExistingKey:async()=>{calls.push('restore');},
      createConversationMaterial:async()=>{throw new Error('should_not_create');},
      createRemote:async()=>{throw new Error('should_not_post');},
      saveCreatedKey:async()=>{calls.push('save');}
    });
    expect(result).toEqual({chatId:'chat-1',keyVersion:1});
    expect(calls).toEqual([]);
  });

  it('restores the current device key for an existing direct chat',async()=>{
    const calls:string[]=[];
    const result=await ensureDirectChat('member-mama',{
      prepare:async()=>({status:'ready',chatId:'chat-2',keyVersion:3,sealedKeyEnvelope:'sealed-for-this-phone'}),
      localKeyExists:async()=>false,
      restoreExistingKey:async ready=>{calls.push(`${ready.chatId}:${ready.sealedKeyEnvelope}`);},
      createConversationMaterial:async()=>{throw new Error('should_not_create');},
      createRemote:async()=>{throw new Error('should_not_post');},
      saveCreatedKey:async()=>{throw new Error('should_not_save_created');}
    });
    expect(result).toEqual({chatId:'chat-2',keyVersion:3});
    expect(calls).toEqual(['chat-2:sealed-for-this-phone']);
  });

  it('creates one key, seals it for every active device and keeps the clear key local',async()=>{
    const calls:string[]=[];
    const key=new Uint8Array([1,2,3,4]);
    const result=await ensureDirectChat('member-mama',{
      prepare:async()=>({status:'needs_key',devices:[
        {deviceId:'phone-a',memberId:'member-me',encryptionPublicKey:'pk-a'},
        {deviceId:'phone-b',memberId:'member-mama',encryptionPublicKey:'pk-b'}
      ]}),
      localKeyExists:async()=>false,
      restoreExistingKey:async()=>{throw new Error('should_not_restore');},
      createConversationMaterial:async devices=>{
        calls.push(`seal:${devices.map(device=>device.deviceId).join(',')}`);
        return {key,envelopes:[
          {deviceId:'phone-a',sealedKeyEnvelope:'sealed-a'},
          {deviceId:'phone-b',sealedKeyEnvelope:'sealed-b'}
        ]};
      },
      createRemote:async(memberId,envelopes)=>{
        calls.push(`post:${memberId}:${envelopes.length}`);
        return {status:'ready',chatId:'chat-new',keyVersion:1};
      },
      saveCreatedKey:async(chatId,keyVersion,savedKey)=>{
        calls.push(`save:${chatId}:${keyVersion}:${Array.from(savedKey).join('.')}`);
      }
    });
    expect(result).toEqual({chatId:'chat-new',keyVersion:1});
    expect(calls).toEqual(['seal:phone-a,phone-b','post:member-mama:2','save:chat-new:1:1.2.3.4']);
  });
});
