importScripts('./version.js');
// v0.15.2: opción 5D en el gráfico de cada posición.
const CACHE='mi-cartera-v'+self.MI_CARTERA_VERSION;
const ASSETS=['./','./index.html','./manifest.webmanifest','./version.js','./config.js','./core.js','./access.js','./analysis.js','./operations.js','./market.js','./app.js','./version.json','./santander.png','./kutxabank.png','./icons/icon-192.png','./icons/icon-512.png'];
const assetURLs=new Set(ASSETS.map(asset=>new URL(asset,self.location.href).href));
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const responses=await Promise.all(ASSETS.map(async asset=>{
    const response=await fetch(asset,{cache:'reload'});
    if(!response.ok)throw new Error('No se pudo descargar '+asset);
    return [asset,response];
  }));
  const release=responses.find(([asset])=>asset==='./version.json');
  if((await release[1].clone().json()).appVersion!==self.MI_CARTERA_VERSION)throw new Error('La publicación todavía está incompleta');
  const cache=await caches.open(CACHE);
  await Promise.all(responses.map(([asset,response])=>cache.put(asset,response)));
  await self.skipWaiting();
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('mi-cartera-v')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // La consulta de versión con ?t= sigue llegando a la red.
    if(assetURLs.has(url.href)){
      const cached=await cache.match(e.request);
      if(cached)return cached;
    }
    try{
      const response=await fetch(e.request,{cache:'no-store'});
      return response;
    }catch{
      const plain=new URL(url);plain.search='';
      const cached=await cache.match(e.request)||await cache.match(plain.href);
      if(cached)return cached;
      if(e.request.mode==='navigate')return await cache.match('./index.html')||Response.error();
      return Response.error();
    }
  })());
});
