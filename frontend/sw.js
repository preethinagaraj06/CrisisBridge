const CACHE='crisisbridge-offline-v15';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.json','./sw.js','./assets/system-architecture.png'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{const cache=await caches.open(CACHE);await Promise.all(ASSETS.map(async asset=>{try{await cache.add(asset)}catch(error){console.warn('Could not pre-cache local asset:',asset,error)}}));await self.skipWaiting()})());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('crisisbridge-')&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim()})());
});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.origin!==self.location.origin)return;
 // The optional LAN API must be attempted live; an offline response must not be cached as real data.
 if(url.pathname.includes('/api/')){event.respondWith(fetch(request).catch(()=>new Response(JSON.stringify({offline:true,available:false,message:'LAN relay unavailable; local device data remains available.'}),{status:503,headers:{'Content-Type':'application/json'}})));return;}
 if(request.mode==='navigate'){
  event.respondWith((async()=>{try{const response=await fetch(request);if(response&&response.ok){const cache=await caches.open(CACHE);cache.put('./index.html',response.clone());return response}}catch{}return (await caches.match(request))||(await caches.match('./index.html'))||(await caches.match('./'))||Response.error()})());return;
 }
 event.respondWith((async()=>{const cached=await caches.match(request);if(cached)return cached;try{const response=await fetch(request);if(response&&response.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone())}return response}catch{return (await caches.match('./index.html'))||Response.error()}})());
});
