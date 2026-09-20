const CACHE='mi-cartera-v0.5.0';
const ASSETS=['./','./index.html','./manifest.webmanifest','./config.js','./app.js','./version.json','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const c=await caches.open(CACHE);
  for(const asset of ASSETS){
    try{const r=await fetch(asset,{cache:'reload'});if(r.ok)await c.put(asset,r.clone());}catch{}
  }
  await self.skipWaiting();
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.hostname.endsWith('.supabase.co'))return;
  if(url.origin!==self.location.origin)return;
  e.respondWith((async()=>{
    try{
      const r=await fetch(e.request,{cache:'no-store'});
      if(r&&r.ok){const c=await caches.open(CACHE);await c.put(e.request,r.clone());}
      return r;
    }catch{
      const cached=await caches.match(e.request);
      if(cached)return cached;
      if(e.request.mode==='navigate')return (await caches.match('./index.html'))||Response.error();
      return Response.error();
    }
  })());
});
