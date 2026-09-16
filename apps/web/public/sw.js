const CACHE='family-shell-v2';
const CACHE_PREFIX='family-shell-';
const STATIC_SHELL=['/manifest.webmanifest','/icon.svg'];

async function installShell(){
  const cache=await caches.open(CACHE);
  const root=await fetch('/',{cache:'no-store'});
  if(!root.ok)throw new Error('shell_root_unavailable');
  const html=await root.clone().text();
  await cache.put('/',root.clone());
  const assets=[];
  const pattern=/\b(?:src|href)=["'](\/assets\/[^"']+)["']/g;
  for(const match of html.matchAll(pattern))if(match[1])assets.push(match[1]);
  await cache.addAll([...new Set([...STATIC_SHELL,...assets])]);
  await self.skipWaiting();
}

self.addEventListener('install',event=>event.waitUntil(installShell()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/')||url.pathname==='/health')return;
  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request);
        if(response.ok){const cache=await caches.open(CACHE);await cache.put('/',response.clone());}
        return response;
      }catch{
        const cache=await caches.open(CACHE);
        const fallback=await cache.match('/');
        if(fallback)return fallback;
        throw new Error('offline_shell_missing');
      }
    })());
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const hit=await cache.match(event.request);
    if(hit)return hit;
    const response=await fetch(event.request);
    if(response.ok)await cache.put(event.request,response.clone());
    return response;
  })());
});
