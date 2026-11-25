// CrisisBridge local-only relay. Runs on the local Wi-Fi/LAN without internet.
// Install Node.js and start with: node server.js
// This is an academic demo server, not hardened for real emergency deployments.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ROOT = path.join(__dirname, 'frontend');
const DATA = path.join(__dirname, 'local-relay-data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
try { fs.chmodSync(DATA, 0o700); } catch {}
// Demo relay token protects the LAN API from unauthenticated reads/writes.
// Set CRISISBRIDGE_RELAY_TOKEN to a securely managed secret for repeatable sessions.
const RELAY_TOKEN = process.env.CRISISBRIDGE_RELAY_TOKEN || crypto.randomBytes(32).toString('hex');
const ALLOWED_ORIGINS = new Set((process.env.CRISISBRIDGE_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
const REQUESTS = new Map();
const INCIDENTS = path.join(DATA, 'incidents.json');
const BROADCASTS = path.join(DATA, 'broadcasts.json');
const PORT = Number(process.env.PORT || 5000);
const MAX_BODY = 22 * 1024 * 1024;
function read(file) { try { const x = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(x) ? x : []; } catch { return []; } }
function write(file, value) { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file); }
function securityHeaders(res) { res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Cache-Control','no-store'); }
function json(res, code, obj) { securityHeaders(res); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function timingSafeEqual(a,b) { const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||'')); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function originAllowed(req) { const origin=req.headers.origin; if(!origin) return true; if(ALLOWED_ORIGINS.has(origin)) return true; try { const o=new URL(origin); const h=String(req.headers.host||'').split(':')[0].replace(/^\[|\]$/g,''); return o.hostname===h || (['localhost','127.0.0.1','::1'].includes(o.hostname)&&['localhost','127.0.0.1','::1'].includes(h)); } catch { return false; } }
function withinRateLimit(req) { const k=req.socket.remoteAddress||'unknown', now=Date.now(); let x=REQUESTS.get(k)||{start:now,count:0}; if(now-x.start>60000)x={start:now,count:0}; x.count++; REQUESTS.set(k,x); if(REQUESTS.size>1000)for(const [key,v] of REQUESTS)if(now-v.start>120000)REQUESTS.delete(key); return x.count<=180; }
function body(req) { return new Promise((resolve, reject) => { let data = ''; req.on('data', chunk => { data += chunk; if (Buffer.byteLength(data) > MAX_BODY) { reject(new Error('Payload too large')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function upsert(list, item, idKey='id') { const id = item?.[idKey]; if (!id) return list; const idx = list.findIndex(x => x[idKey] === id); const stamp = new Date().toISOString(); const next = { ...item, updatedAt: item.updatedAt || stamp }; if (idx >= 0) list[idx] = { ...list[idx], ...next, updatedAt: stamp }; else list.unshift({ ...next, updatedAt: stamp }); return list.slice(0, 1000); }
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  if (!originAllowed(req)) return json(res,403,{error:'Origin not allowed'});
  if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
  if (!withinRateLimit(req)) return json(res,429,{error:'Too many requests; try again shortly'});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization' }); return res.end(); }
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
    const auth=req.headers.authorization||'';
    if(!auth.startsWith('Bearer ') || !timingSafeEqual(auth.slice(7),RELAY_TOKEN)) return json(res,401,{error:'Relay authorization required'});
  }
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok:true, mode:'local-lan-no-internet-required', incidents:read(INCIDENTS).length, broadcasts:read(BROADCASTS).length });
    if (url.pathname === '/api/incidents' && req.method === 'GET') { const since = Number(url.searchParams.get('since') || 0); const items = read(INCIDENTS).filter(x => new Date(x.updatedAt || x.createdAt || 0).getTime() >= since); return json(res, 200, { incidents:items }); }
    if (url.pathname === '/api/incidents' && req.method === 'POST') { const b = await body(req); if (!b.incident?.id) return json(res,400,{error:'incident.id required'}); const list=read(INCIDENTS); const record={...b.incident,audioDataUrl:typeof b.audioDataUrl==='string'?b.audioDataUrl:(list.find(x=>x.id===b.incident.id)?.audioDataUrl||null),updatedAt:new Date().toISOString()}; upsert(list,record); write(INCIDENTS,list); return json(res,200,{ok:true,incident:{id:record.id,updatedAt:record.updatedAt}}); }
    if (url.pathname === '/api/emergency-broadcasts' && req.method === 'GET') { const since=Number(url.searchParams.get('since')||0); return json(res,200,{broadcasts:read(BROADCASTS).filter(x=>new Date(x.updatedAt||x.startedAt||0).getTime()>=since)}); }
    if (url.pathname === '/api/emergency-broadcasts' && req.method === 'POST') { const b=await body(req); if(!b.broadcast?.id)return json(res,400,{error:'broadcast.id required'}); const list=read(BROADCASTS); const old=list.find(x=>x.id===b.broadcast.id); const record={...b.broadcast,audioUrl:b.audioDataUrl || old?.audioUrl || b.broadcast.audioUrl || null,updatedAt:new Date().toISOString()}; upsert(list,record); write(BROADCASTS,list); return json(res,200,{ok:true,broadcast:record}); }
    // Static app; prevent path traversal.
    let pathname = decodeURIComponent(url.pathname); if (pathname === '/') pathname='/index.html';
    const file = path.resolve(ROOT, '.' + pathname); if (!file.startsWith(path.resolve(ROOT)+path.sep) && file!==path.resolve(ROOT,'index.html')) return json(res,403,{error:'forbidden'});
    fs.readFile(file,(err,content)=>{ if(err){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found');} securityHeaders(res); res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':path.extname(file)==='.html'?'no-cache':'public, max-age=3600'});res.end(content); });
  } catch (e) { json(res, e.message==='Payload too large'?413:400, {error:e.message||'request failed'}); }
});
server.listen(PORT,'0.0.0.0',()=>{ console.log(`CrisisBridge local relay running on port ${PORT}`); console.log('Relay access token (keep private; enter it when prompted):'); console.log(RELAY_TOKEN); console.log('ACADEMIC DEMO ONLY — not Government approved or certified for real emergency dispatch.'); console.log(`This laptop: http://localhost:${PORT}`); const nets=os.networkInterfaces(); for(const list of Object.values(nets)) for(const item of (list||[])) if(item.family==='IPv4'&&!item.internal) console.log(`Other devices on same Wi-Fi: http://${item.address}:${PORT}`); console.log('Internet is not required while this laptop and the local Wi-Fi/LAN remain available.'); });
