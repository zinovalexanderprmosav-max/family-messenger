const CACHE='family-shell-v2';
const SHELL=['/manifest.webmanifest','/icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith('family-shell-')&&key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/')||url.pathname==='/health')return;

  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request)
        .then(async response=>{
          if(response.ok){const cache=await caches.open(CACHE);await cache.put('/',response.clone());}
          return response;
        })
        .catch(async()=>await caches.match('/')??Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached=>{
      const network=fetch(event.request).then(async response=>{
        if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());}
        return response;
      });
      return cached??network;
    })
  );
});
