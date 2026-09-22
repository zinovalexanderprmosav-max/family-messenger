const CACHE='family-shell-v5-ios-standalone';
const SHELL=['/manifest.webmanifest','/icon.svg'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name!==CACHE).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/')||url.pathname==='/health')return;

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(event.request,{cache:'no-store'});
        if(fresh.ok){
          const cache=await caches.open(CACHE);
          await cache.put('/',fresh.clone());
        }
        return fresh;
      }catch{
        return (await caches.match('/'))??Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    try{
      const fresh=await fetch(event.request,{cache:'no-store'});
      if(fresh.ok){
        const cache=await caches.open(CACHE);
        await cache.put(event.request,fresh.clone());
      }
      return fresh;
    }catch{
      return (await caches.match(event.request))??Response.error();
    }
  })());
});
