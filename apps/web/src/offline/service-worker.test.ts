// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe,expect,it,vi } from 'vitest';

const source=readFileSync(new URL('../../public/sw.js',import.meta.url),'utf8');

type Listener=(event:any)=>void;

function createHarness(){
  const listeners:Record<string,Listener>={};
  const addAll=vi.fn(async()=>{});
  const put=vi.fn(async()=>{});
  const remove=vi.fn(async()=>true);
  const claim=vi.fn(async()=>{});
  const skipWaiting=vi.fn(async()=>{});
  const cache={addAll,put};
  const cachesMock={
    open:vi.fn(async()=>cache),
    keys:vi.fn(async()=>['family-shell-v1','unrelated-cache']),
    delete:remove,
    match:vi.fn(async()=>undefined)
  };
  const fetchMock=vi.fn(async(input:unknown)=>{
    if(input==='/')return new Response('<!doctype html><link rel="stylesheet" href="/assets/index-dark.css"><script type="module" src="/assets/index-app.js"></script>',{status:200,headers:{'content-type':'text/html'}});
    return new Response('asset',{status:200});
  });
  const selfMock={
    location:{origin:'https://family.example'},
    clients:{claim},
    skipWaiting,
    addEventListener:(type:string,listener:Listener)=>{listeners[type]=listener;}
  };
  vm.runInNewContext(source,{self:selfMock,caches:cachesMock,fetch:fetchMock,Response,Request,URL,Promise,console});
  return {listeners,addAll,put,remove,claim,skipWaiting,cachesMock,fetchMock};
}

async function dispatchWaitUntil(listener:Listener|undefined){
  if(!listener)throw new Error('listener_missing');
  let pending:Promise<unknown>|undefined;
  listener({waitUntil:(promise:Promise<unknown>)=>{pending=promise;}});
  await pending;
}

describe('service worker offline shell',()=>{
  it('pre-caches the current hashed Vite assets during install',async()=>{
    const h=createHarness();
    await dispatchWaitUntil(h.listeners.install);
    expect(h.fetchMock).toHaveBeenCalledWith('/',expect.objectContaining({cache:'no-store'}));
    expect(h.put).toHaveBeenCalledWith('/',expect.any(Response));
    expect(h.addAll).toHaveBeenCalledWith(expect.arrayContaining(['/manifest.webmanifest','/icon.svg','/assets/index-dark.css','/assets/index-app.js']));
    expect(h.skipWaiting).toHaveBeenCalledOnce();
  });

  it('removes the old family shell cache on activation',async()=>{
    const h=createHarness();
    await dispatchWaitUntil(h.listeners.activate);
    expect(h.remove).toHaveBeenCalledWith('family-shell-v1');
    expect(h.remove).not.toHaveBeenCalledWith('unrelated-cache');
    expect(h.claim).toHaveBeenCalledOnce();
  });
});
