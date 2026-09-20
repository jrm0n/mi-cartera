const CACHE='mi-cartera-v0.4.3';
const ASSETS=['./','./index.html','./manifest.webmanifest','./config.js','./app.js','./version.json','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.hostname.endsWith('.supabase.co'))return;
  if(url.origin!==self.location.origin)return;
  e.respondWith(
    fetch(e.request,{cache:'no-store'}).then(resp=>{
      if(resp&&resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
      return resp;
    }).catch(async()=>{
      const cached=await caches.match(e.request);
      if(cached)return cached;
      if(e.request.mode==='navigate')return caches.match('./index.html');
      return Response.error();
    })
  );
});
