const CACHE='family-shell-v1';
const SHELL=['/','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/')||url.pathname==='/health')return;
  event.respondWith(caches.match(event.request).then(async hit=>{
    if(hit)return hit;
    const response=await fetch(event.request);
    if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());}
    return response;
  }));
});
