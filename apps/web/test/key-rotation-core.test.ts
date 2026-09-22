// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {rotateChatKeyCore} from '../src/flows/key-rotation-core.js';

describe('key rotation core',()=>{
  it('uses one generated key, posts exact envelopes, and saves only after submit succeeds',async()=>{
    const events:string[]=[];
    const key=new Uint8Array([1,2,3,4]);
    let submitted:any;
    const result=await rotateChatKeyCore('chat',{
      getStatus:async()=>({status:'required',chatId:'00000000-0000-4000-8000-000000000001',fromKeyVersion:3,nextKeyVersion:4,devices:[
        {deviceId:'00000000-0000-4000-8000-000000000011',memberId:'00000000-0000-4000-8000-000000000021',encryptionPublicKey:'pk-a'},
        {deviceId:'00000000-0000-4000-8000-000000000012',memberId:'00000000-0000-4000-8000-000000000022',encryptionPublicKey:'pk-b'}
      ]}),
      generateKey:async()=>{events.push('generate');return key;},
      sealKey:async(candidate,publicKey)=>{expect(candidate).toBe(key);events.push('seal:'+publicKey);return 'sealed-'+publicKey;},
      submit:async(_chatId,request)=>{events.push('submit');submitted=request;},
      save:async(_chatId,keyVersion,candidate)=>{events.push('save');expect(keyVersion).toBe(4);expect(candidate).toBe(key);},
      currentVersion:async()=>3
    });
    expect(result).toEqual({keyVersion:4,rotated:true});
    expect(submitted).toEqual({
      fromKeyVersion:3,nextKeyVersion:4,envelopes:[
        {deviceId:'00000000-0000-4000-8000-000000000011',sealedKeyEnvelope:'sealed-pk-a'},
        {deviceId:'00000000-0000-4000-8000-000000000012',sealedKeyEnvelope:'sealed-pk-b'}
      ]
    });
    expect(events).toEqual(['generate','seal:pk-a','seal:pk-b','submit','save']);
  });

  it('does not generate or save a key when rotation is not required',async()=>{
    let generated=false,saved=false;
    const result=await rotateChatKeyCore('chat',{
      getStatus:async()=>({status:'not_required'}),
      generateKey:async()=>{generated=true;return new Uint8Array(32);},
      sealKey:async()=>'',submit:async()=>{},
      save:async()=>{saved=true;},
      currentVersion:async()=>7
    });
    expect(result).toEqual({keyVersion:7,rotated:false});
    expect(generated).toBe(false);expect(saved).toBe(false);
  });

  it('never saves a generated key when server submission fails',async()=>{
    let saved=false;
    await expect(rotateChatKeyCore('chat',{
      getStatus:async()=>({status:'required',chatId:'00000000-0000-4000-8000-000000000001',fromKeyVersion:1,nextKeyVersion:2,devices:[
        {deviceId:'00000000-0000-4000-8000-000000000011',memberId:'00000000-0000-4000-8000-000000000021',encryptionPublicKey:'pk'}
      ]}),
      generateKey:async()=>new Uint8Array(32),
      sealKey:async()=> 'sealed',
      submit:async()=>{throw new Error('device_key_set_changed');},
      save:async()=>{saved=true;},
      currentVersion:async()=>1
    })).rejects.toThrow('device_key_set_changed');
    expect(saved).toBe(false);
  });
});
