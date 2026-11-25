const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const S={get(k,d){try{let x=localStorage.getItem(k);return x===null?d:JSON.parse(x)}catch{return d}},set(k,v){localStorage.setItem(k,JSON.stringify(v))}};
// Per-tab session: allows Authority and Citizen to be logged in simultaneously on one laptop.
const SESSION={get(){try{const x=sessionStorage.getItem('cb_session');return x?JSON.parse(x):null}catch{return null}},set(v){try{if(v===null)sessionStorage.removeItem('cb_session');else sessionStorage.setItem('cb_session',JSON.stringify(v))}catch{}}};
// Offline voice-note storage. Audio blobs stay on this device and are shared by same-origin tabs.
const AudioStore={db:null,async open(){if(this.db)return this.db;return new Promise((resolve,reject)=>{if(!('indexedDB'in window))return reject(new Error('IndexedDB unavailable'));const r=indexedDB.open('CrisisBridgeOfflineAudio',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio');r.onsuccess=()=>{this.db=r.result;resolve(this.db)};r.onerror=()=>reject(r.error)})},async put(key,blob){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put(blob,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})},async get(key){try{const db=await this.open();return await new Promise((resolve,reject)=>{const tx=db.transaction('audio','readonly');const q=tx.objectStore('audio').get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error)})}catch{return null}},async del(key){try{const db=await this.open();const tx=db.transaction('audio','readwrite');tx.objectStore('audio').delete(key)}catch{}}};

/* Robust same-device voice fallback for the one-laptop presentation.
   IndexedDB remains the primary audio store. A short emergency recording is
   also cached as a data URL in LocalStorage so a second same-origin tab can
   still play it if IndexedDB access is delayed or unavailable. */
const VoiceCache={
  prefix:"cb_voice_",
  async put(key,blob){
    try{
      if(!key||!blob)return false;
      const data=await blobToDataUrl(blob);
      if(data && data.length<=4200000){localStorage.setItem(this.prefix+key,data);return true;}
    }catch(e){console.info("Voice LocalStorage fallback unavailable.",e);}
    return false;
  },
  get(key){try{return key?localStorage.getItem(this.prefix+key):null}catch{return null}},
  del(key){try{if(key)localStorage.removeItem(this.prefix+key)}catch{}}
};

// Optional LAN bridge: keeps LocalStorage/IndexedDB as the offline fallback,
// while allowing authority voice broadcasts to reach another laptop on the same Wi-Fi/LAN.
const LAN_API_BASE=(window.CRISISBRIDGE_SERVER_URL!==undefined)?String(window.CRISISBRIDGE_SERVER_URL).replace(/\/$/,''):(location.port==='5000'?'':`${location.protocol}//${location.hostname}:5000`);
const LAN_BROADCAST_API=()=>`${LAN_API_BASE}/api/emergency-broadcasts`;
// Shared LAN demo token: entered once per browser tab/session. Never hard-code secrets in source.
function relayAuthHeaders(){let token='',localOnly=false;try{token=sessionStorage.getItem('cb_lan_relay_token')||'';localOnly=sessionStorage.getItem('cb_lan_local_only')==='1';}catch{}if(!token&&!localOnly){token=window.prompt('Enter the CrisisBridge relay token shown in the server terminal. Leave blank to use local-only mode:')||'';try{if(token)sessionStorage.setItem('cb_lan_relay_token',token);else sessionStorage.setItem('cb_lan_local_only','1');}catch{}}return token?{Authorization:`Bearer ${token}`}:{'X-CrisisBridge-Local-Only':'1'};}
function relayHeaders(){return {'Content-Type':'application/json',...relayAuthHeaders()};}

async function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
async function publishBroadcastToLAN(b){
  if(!b)return null;
  try{
    let audioDataUrl=null;
    if(b.audioKey){
      const blob=await AudioStore.get(b.audioKey);
      if(blob){
        if(blob.size>15*1024*1024) throw new Error('Voice recording is larger than the 15 MB LAN demo limit.');
        audioDataUrl=await blobToDataUrl(blob);
      }
    }
    const res=await fetch(LAN_BROADCAST_API(),{method:'POST',headers:relayHeaders(),body:JSON.stringify({broadcast:{...b,_audioBlob:undefined},audioDataUrl})});
    if(!res.ok)throw new Error(`LAN server ${res.status}`);
    return await res.json();
  }catch(e){console.info('LAN broadcast unavailable; local offline delivery remains active.',e);return null;}
}
async function fetchLANBroadcasts(){
  try{const r=await fetch(`${LAN_BROADCAST_API()}?since=${encodeURIComponent(state.lastLanBroadcastSync||0)}`,{cache:'no-store',headers:relayAuthHeaders()});if(!r.ok)return;const data=await r.json();const list=Array.isArray(data.broadcasts)?data.broadcasts:[];for(const b of list){const stamp=Number(new Date(b.updatedAt||b.startedAt||0).getTime()||0);state.lastLanBroadcastSync=Math.max(Number(state.lastLanBroadcastSync||0),stamp);const old=(state.receivedBroadcasts||[]).find(x=>x.id===b.id);const changed=!old||old.updatedAt!==b.updatedAt||old.active!==b.active||old.audioUrl!==b.audioUrl;if(changed)await receiveBroadcast(b,'lan-sync');}if(list.length&&state.page==='alerts')alerts();}catch(e){/* LAN server optional; do not break offline mode */}
}
async function blobToDataUrlSafe(blob){return await blobToDataUrl(blob);}
async function publishIncidentToLAN(incident){
 try{
  if(!incident)return null;
  let audioDataUrl=null;
  if(incident.audioKey){const blob=await AudioStore.get(incident.audioKey);if(blob){if(blob.size>15*1024*1024)throw new Error('Voice report exceeds 15 MB LAN demo limit');audioDataUrl=await blobToDataUrlSafe(blob);}}
  const response=await fetch(`${LAN_API_BASE}/api/incidents`,{method:'POST',headers:relayHeaders(),body:JSON.stringify({incident:{...incident},audioDataUrl})});
  if(!response.ok)throw new Error(`LAN incident relay ${response.status}`);
  return await response.json();
 }catch(error){console.info('Incident stays saved locally; LAN relay unavailable.',error);return null;}
}
async function fetchLANIncidents(){
 try{
  const response=await fetch(`${LAN_API_BASE}/api/incidents?since=${encodeURIComponent(state.lastLanIncidentSync||0)}`,{cache:'no-store',headers:relayAuthHeaders()});
  if(!response.ok)return;const data=await response.json();const remote=Array.isArray(data.incidents)?data.incidents:[];let changed=false;
  for(const item of remote){
   const incoming={...item};const audioDataUrl=incoming.audioDataUrl;delete incoming.audioDataUrl;
   const stamp=Number(new Date(incoming.updatedAt||incoming.createdAt||0).getTime()||0);state.lastLanIncidentSync=Math.max(Number(state.lastLanIncidentSync||0),stamp);
   const index=state.incidents.findIndex(x=>x.id===incoming.id);const current=index>=0?state.incidents[index]:null;
   // Only replace a local copy when the relay version is newer; never remove local-only incidents.
   const currentStamp=Number(new Date(current?.updatedAt||current?.createdAt||0).getTime()||0);
   if(!current||stamp>=currentStamp){
    if(audioDataUrl){try{const blob=await (await fetch(audioDataUrl)).blob();const key=`lan-audio-${incoming.id}`;await AudioStore.put(key,blob);incoming.audioKey=key;}catch(err){console.warn('Could not cache relayed voice report',err);}}
    if(index>=0)state.incidents[index]={...current,...incoming};else state.incidents.unshift(incoming);changed=true;
   }
  }
  if(changed){save();if(state.page==='incidents')incidents();else if(state.page==='dashboard')render('dashboard');}
 }catch(error){/* Local offline mode remains available without a relay. */}
}

const LANG={
en:{dashboard:"Dashboard",report:"Emergency Report",incidents:"Incidents",map:"Live Map",rescue:"Rescue Teams",volunteers:"Volunteers",shelters:"Shelters",resources:"Resources",broadcast:"Broadcast",alerts:"Emergency Alerts",information:"Safety Information",analytics:"Analytics",profile:"My Profile",architecture:"Architecture",smart:"Smart Operations"},
ta:{dashboard:"டாஷ்போர்டு",report:"அவசர அறிக்கை",incidents:"சம்பவங்கள்",map:"நேரடி வரைபடம்",rescue:"மீட்புக் குழுக்கள்",volunteers:"தன்னார்வலர்கள்",shelters:"தங்குமிடங்கள்",resources:"வளங்கள்",broadcast:"அவசர ஒலிபரப்பு",alerts:"அவசர எச்சரிக்கைகள்",information:"பாதுகாப்புத் தகவல்",analytics:"பகுப்பாய்வு",profile:"என் சுயவிவரம்",architecture:"கட்டமைப்பு",smart:"ஸ்மார்ட் செயல்பாடுகள்"},
hi:{dashboard:"डैशबोर्ड",report:"आपात रिपोर्ट",incidents:"घटनाएँ",map:"लाइव मैप",rescue:"बचाव दल",volunteers:"स्वयंसेवक",shelters:"आश्रय",resources:"संसाधन",broadcast:"आपात प्रसारण",alerts:"आपात चेतावनियाँ",information:"सुरक्षा जानकारी",analytics:"विश्लेषण",profile:"मेरी प्रोफ़ाइल",architecture:"आर्किटेक्चर",smart:"स्मार्ट संचालन"},
te:{dashboard:"డాష్‌బోర్డ్",report:"అత్యవసర నివేదిక",incidents:"సంఘటనలు",map:"లైవ్ మ్యాప్",rescue:"రెస్క్యూ టీమ్స్",volunteers:"వాలంటీర్లు",shelters:"షెల్టర్లు",resources:"వనరులు",broadcast:"అత్యవసర ప్రసారం",alerts:"అత్యవసర హెచ్చరికలు",information:"భద్రత సమాచారం",analytics:"విశ్లేషణ",profile:"నా ప్రొఫైల్",architecture:"ఆర్కిటెక్చర్",smart:"స్మార్ట్ ఆపరేషన్స్"},
kn:{dashboard:"ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",report:"ತುರ್ತು ವರದಿ",incidents:"ಘಟನೆಗಳು",map:"ಲೈವ್ ನಕ್ಷೆ",rescue:"ರಕ್ಷಣಾ ತಂಡಗಳು",volunteers:"ಸ್ವಯಂಸೇವಕರು",shelters:"ಆಶ್ರಯಗಳು",resources:"ಸಂಪನ್ಮೂಲಗಳು",broadcast:"ತುರ್ತು ಪ್ರಸಾರ",alerts:"ತುರ್ತು ಎಚ್ಚರಿಕೆಗಳು",information:"ಸುರಕ್ಷತಾ ಮಾಹಿತಿ",analytics:"ವಿಶ್ಲೇಷಣೆ",profile:"ನನ್ನ ಪ್ರೊಫೈಲ್",architecture:"ಆರ್ಕಿಟೆಕ್ಚರ್"},
ml:{dashboard:"ഡാഷ്ബോർഡ്",report:"അടിയന്തര റിപ്പോർട്ട്",incidents:"സംഭവങ്ങൾ",map:"ലൈവ് മാപ്പ്",rescue:"രക്ഷാ ടീമുകൾ",volunteers:"വോളണ്ടിയർമാർ",shelters:"ഷെൽട്ടറുകൾ",resources:"വിഭവങ്ങൾ",broadcast:"അടിയന്തര പ്രക്ഷേപണം",alerts:"അടിയന്തര മുന്നറിയിപ്പുകൾ",information:"സുരക്ഷാ വിവരം",analytics:"വിശകലനം",profile:"എന്റെ പ്രൊഫൈൽ",architecture:"ആർക്കിടെക്ചർ",smart:"സ്മാർട്ട് പ്രവർത്തനം"}
};
const PAGE_TITLES={en:{dashboard:"Dashboard",report:"Emergency Report",incidents:"Incidents",map:"Live Map",rescue:"Rescue Teams",volunteers:"Volunteers",shelters:"Shelters",resources:"Resources",broadcast:"Emergency Broadcast",alerts:"Emergency Alerts",information:"Safety Information",analytics:"Analytics",profile:"My Profile",architecture:"System Architecture",smart:"Smart Operations"},ta:{dashboard:"டாஷ்போர்டு",report:"அவசர அறிக்கை",incidents:"சம்பவங்கள்",map:"நேரடி வரைபடம்",rescue:"மீட்புக் குழுக்கள்",volunteers:"தன்னார்வலர்கள்",shelters:"தங்குமிடங்கள்",resources:"வளங்கள்",broadcast:"அவசர ஒலிபரப்பு",alerts:"அவசர எச்சரிக்கைகள்",information:"பாதுகாப்புத் தகவல்",analytics:"பகுப்பாய்வு",profile:"என் சுயவிவரம்",architecture:"கட்டமைப்பு",smart:"ஸ்மார்ட் செயல்பாடுகள்"},hi:{dashboard:"डैशबोर्ड",report:"आपात रिपोर्ट",incidents:"घटनाएँ",map:"लाइव मैप",rescue:"बचाव दल",volunteers:"स्वयंसेवक",shelters:"आश्रय",resources:"संसाधन",broadcast:"आपात प्रसारण",alerts:"आपात चेतावनियाँ",information:"सुरक्षा जानकारी",analytics:"विश्लेषण",profile:"मेरी प्रोफ़ाइल",architecture:"सिस्टम आर्किटेक्चर"}};
const USERS=[
{id:"U1001",name:"Sandeep Kumar",email:"citizen@crisisbridge.demo",phone:"+91 90000 10001",password:"123456",role:"citizen",area:"Hosur, Tamil Nadu",skills:["Citizen"]},
{id:"U1002",name:"Arun Volunteer",email:"volunteer@crisisbridge.demo",phone:"+91 90000 10002",password:"123456",role:"volunteer",area:"Hosur, Tamil Nadu",skills:["First Aid","Search & Rescue","Communication"]},
{id:"U1003",name:"Meena Authority",email:"authority@crisisbridge.demo",phone:"+91 90000 10003",password:"123456",role:"authority",area:"Hosur Control Centre",skills:["Incident Command","Logistics","Emergency Planning"]}
];
const SEED=[
{id:"CB-1050",type:"Flood Rescue",severity:"critical",people:8,location:"Ukkadam, Coimbatore",lat:11.0168,lng:76.9558,description:"Family trapped on first floor. Elderly person requires assistance.",status:"VERIFIED",reportedBy:"Citizen",time:"8 min ago",verified:true,medical:true},
{id:"CB-1049",type:"Medical Emergency",severity:"high",people:2,location:"Bagalur Road, Hosur",lat:12.7356,lng:77.8320,description:"Two people need urgent medical assistance.",status:"ASSIGNED",reportedBy:"Volunteer",time:"16 min ago",verified:true,medical:true},
{id:"CB-1048",type:"Road Blockage",severity:"medium",people:0,location:"Old Bus Stand, Hosur",lat:12.7409,lng:77.8253,description:"Fallen tree blocking one lane.",status:"IN PROGRESS",reportedBy:"Citizen",time:"31 min ago",verified:true,medical:false},
{id:"CB-1047",type:"Shelter Request",severity:"high",people:24,location:"Kelamangalam",lat:12.6020,lng:77.8510,description:"Families require safe shelter and drinking water.",status:"OPEN",reportedBy:"Citizen",time:"48 min ago",verified:false,medical:false},
{id:"CB-1046",type:"Fire",severity:"critical",people:5,location:"SIPCOT, Hosur",lat:12.7600,lng:77.8000,description:"Smoke and fire reported near an industrial area.",status:"ASSIGNED",reportedBy:"Authority",time:"1 hr ago",verified:true,medical:false}
];
const DEFAULT_SHELTERS=[
{name:"Government Higher Secondary School",area:"Bagalur",lat:12.732,lng:77.828,capacity:500,occupied:320,water:true,food:true,medical:true,accessible:true},
{name:"Hosur Municipal Relief Centre",area:"Hosur",lat:12.7409,lng:77.8253,capacity:600,occupied:318,water:true,food:true,medical:true,accessible:true},
{name:"Community Hall – Kelamangalam",area:"Kelamangalam",lat:12.602,lng:77.851,capacity:220,occupied:82,water:true,food:false,medical:false,accessible:false}
];
const DEFAULT_TEAMS=[
{id:"RT-07",name:"Alpha Rescue",members:6,vehicle:"Rescue Van",status:"DEPLOYED",area:"Ukkadam",eta:"12 min"},
{id:"RT-04",name:"Hosur Medical Unit",members:4,vehicle:"Ambulance",status:"AVAILABLE",area:"Hosur",eta:"—"},
{id:"RT-11",name:"Water Rescue",members:8,vehicle:"Boat",status:"STANDBY",area:"Kelamangalam",eta:"18 min"}
];
const DEFAULT_RESOURCES=[
{name:"Drinking Water",unit:"packs",available:1840,required:2400},
{name:"Food Packets",unit:"packs",available:2350,required:3100},
{name:"Blankets",unit:"units",available:620,required:900},
{name:"First Aid Kits",unit:"kits",available:128,required:160}
];

let state={
 user:SESSION.get(),lang:S.get("cb_lang","en"),page:"dashboard",
 incidents:S.get("cb_incidents",SEED),gps:S.get("cb_gps",null),
 notifications:S.get("cb_notifications",[
  {title:"Critical incident verified",text:"CB-1050 verified by response team.",time:"8 min ago"},
  {title:"Rescue dispatched",text:"Alpha Rescue assigned to CB-1050.",time:"11 min ago"},
  {title:"Shelter capacity",text:"Government Higher Secondary School has 180 spaces.",time:"22 min ago"}
 ]),
 shelters:S.get("cb_shelters",DEFAULT_SHELTERS),
 teams:S.get("cb_teams",DEFAULT_TEAMS),
 resources:S.get("cb_resources",DEFAULT_RESOURCES),
 broadcasts:S.get("cb_broadcasts",[]),
 receivedBroadcasts:S.get("cb_receivedBroadcasts",[]),
 auditLogs:S.get("cb_auditLogs",[]), weatherCache:S.get("cb_weatherCache",null)
};

// Prototype self-healing: always keep at least one dispatchable team for a fresh offline demo.
function ensureDispatchCapacity(){
 const dispatchable=state.teams.some(t=>["AVAILABLE","STANDBY"].includes(t.status));
 if(!dispatchable && state.teams.length){
   const preferred=state.teams.find(t=>t.id==="RT-04")||state.teams[0];
   preferred.status="AVAILABLE";
   preferred.eta="—";
   save();
 }
}
ensureDispatchCapacity();

// Citizen voice-report attachment for the current emergency form.
let pendingReportAudioKey=null;

const roleLabel=r=>r==="authority"?"Authority":r==="volunteer"?"Volunteer":"Citizen";
function userNotify(title,text,userId=null){state.notifications.unshift({title,text,time:"just now",userId});}
const initials=n=>(n||"U").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const t=k=>(LANG[state.lang]||LANG.en)[k]||LANG.en[k]||k;
function save(){
 try{
  S.set("cb_incidents",state.incidents);S.set("cb_notifications",state.notifications);
  S.set("cb_lang",state.lang);S.set("cb_shelters",state.shelters);
  S.set("cb_teams",state.teams);S.set("cb_resources",state.resources);
  // Only the authority tab may write the shared broadcast feed; citizen tabs can hold stale copies.
  if(state.user?.role==="authority")S.set("cb_broadcasts",state.broadcasts);
  S.set("cb_receivedBroadcasts",state.receivedBroadcasts||[]);S.set("cb_auditLogs",state.auditLogs||[]);S.set("cb_weatherCache",state.weatherCache||null);
  if(state.gps)S.set("cb_gps",state.gps);
  return true;
 }catch(e){
  console.warn("CrisisBridge local save failed",e);
  return false;
 }
}
// Sync reports submitted in another same-origin tab (for example, Citizen → Authority).
window.addEventListener("storage",e=>{
 if(e.key==="cb_incidents"&&e.newValue){try{state.incidents=JSON.parse(e.newValue);if(state.page==="incidents")incidents();else if(state.page==="dashboard")render("dashboard");}catch(err){console.warn("Could not sync incident updates",err)}}
 if(e.key==="cb_notifications"&&e.newValue){try{state.notifications=JSON.parse(e.newValue);renderNotifications()}catch{}}
});

function toast(m){let d=document.createElement("div");d.className="toastmsg";d.textContent=m;$("#toast").appendChild(d);setTimeout(()=>d.remove(),2800)}
function score(i){let n={critical:82,high:65,medium:45,low:22}[i.severity]||35;n+=Math.min(12,(i.people||0)*1.5);if(i.medical)n+=10;if(i.verified)n+=4;if(["elderly","child","pregnant","disability","multiple"].includes(i.vulnerability))n+=8;const age=i.createdAt?Math.floor((Date.now()-new Date(i.createdAt).getTime())/60000):0;n+=Math.min(8,Math.max(0,age/10));if(i.hazardRisk)n+=Math.min(8,i.hazardRisk);return Math.min(100,Math.round(n))}
function badge(x){return `<span class="badge ${x}">${String(x).toUpperCase()}</span>`}
function statBadge(x){let c=x==="VERIFIED"?"verified":x==="ASSIGNED"?"assigned":x==="IN PROGRESS"?"progress":x==="RESOLVED"?"resolved":"open";return badge(c).replace(String(c).toUpperCase(),x)}
function allowed(p){
 if(!state.user)return false;
 if(state.user.role==="citizen")return ["dashboard","report","incidents","map","shelters","alerts","information","profile"].includes(p);
 if(state.user.role==="volunteer")return ["dashboard","report","incidents","map","rescue","volunteers","shelters","resources","alerts","information","profile","smart"].includes(p);
 return ["dashboard","incidents","map","rescue","volunteers","shelters","resources","broadcast","information","analytics","profile","architecture","smart"].includes(p);
}
const ICON={dashboard:"▦",report:"＋",incidents:"◉",map:"⌖",rescue:"🚑",volunteers:"♟",shelters:"⌂",resources:"▤",broadcast:"📢",alerts:"🚨",information:"ⓘ",analytics:"◒",profile:"●",architecture:"⌘",smart:"✦"};

function nav(){
 const groups=state.user.role==="citizen"?[
 ["OPERATIONS",["dashboard","report","incidents","map"]],["COMMUNITY",["shelters","alerts","information"]]
 ]:state.user.role==="volunteer"?[
 ["FIELD OPERATIONS",["dashboard","incidents","map","rescue"]],["COMMUNITY",["volunteers","shelters","resources","alerts","information","smart"]]
 ]:[
 ["COMMAND CENTRE",["dashboard","incidents","map","rescue"]],["COORDINATION",["volunteers","shelters","resources","broadcast"]],["INTELLIGENCE",["smart","analytics","information","architecture"]]
 ];
 $("#nav").innerHTML=groups.map(g=>`<div class="nav-group">${g[0]}</div>`+g[1].filter(allowed).map(p=>`<button class="navbtn ${state.page===p?"active":""}" data-page="${p}">${ICON[p]} <span data-i18n="${p}">${t(p)}</span></button>`).join("")).join("");
 $$(".navbtn[data-page]").forEach(b=>b.onclick=()=>go(b.dataset.page));
}
function shell(){
 $("#userName").textContent=state.user.name;$("#userRole").textContent=roleLabel(state.user.role);$("#avatar").textContent=initials(state.user.name);$("#roleText").textContent=roleLabel(state.user.role)+" workspace";
 $("#language").value=state.lang;nav();renderNotifications();
 // shell() refreshes the sidebar, so re-bind Logout every time the app shell is rendered.
 $("#logout").onclick=logout;
}
function go(p){
 if(!allowed(p))p="dashboard";state.page=p;
 $$(".page").forEach(x=>x.classList.remove("active"));$("#"+p).classList.add("active");
 $("#title").textContent=p==="dashboard"?"Dashboard":t(p);$("#section").textContent=p==="dashboard"?"Operations":"CrisisBridge";
 nav();render(p);window.scrollTo(0,0);if(innerWidth<801)$("#sidebar").classList.remove("open");
}
function render(p){
 ({dashboard:dashboard,report:report,incidents:incidents,map:mapPage,rescue:rescue,volunteers:volunteers,shelters:shelters,resources:resources,broadcast:broadcast,alerts:alerts,information:information,analytics:analytics,profile:profile,architecture:architecture,smart:smart}[p])();
}
function pageTop(title,sub,action=""){let key=Object.keys(PAGE_TITLES.en).find(k=>PAGE_TITLES.en[k]===title)||title;let shown=(PAGE_TITLES[state.lang]||PAGE_TITLES.en)[key]||title;return `<div class="head"><div><div class="eyebrow">CRISISBRIDGE</div><h1>${shown}</h1><p>${sub}</p></div>${action?`<div class="actions">${action}</div>`:""}</div>`}
function kpi(label,val,foot){return `<div class="kpi"><small>${label}</small><strong>${val}</strong><em>${foot}</em></div>`}
function dashboard(){
 const r=state.user.role, active=state.incidents.filter(i=>i.status!=="RESOLVED").length, critical=state.incidents.filter(i=>i.severity==="critical").length;
 if(r==="citizen")return citizenDash(active);
 if(r==="volunteer")return volunteerDash(active);
 return authorityDash(active,critical);
}
function citizenDash(active){
 const myReports=state.incidents.filter(i=>i.reporterId===state.user.id||i.reporterEmail===state.user.email);
 const assigned=myReports.find(i=>i.assignedShelter!=null)||myReports.find(i=>i.assignedTeam||((i.resourcesAllocated||[]).length));
 const shelterIndex=assigned?.assignedShelter??state.user.assignedShelter;
 const sh=shelterIndex!=null?(state.shelters[shelterIndex]||null):null;
 const free=sh?Math.max(0,sh.capacity-sh.occupied):0;
 const team=assigned?.assignedTeam||null;
 const allocations=assigned?.resourcesAllocated||[];
 const hasResponse=!!(assigned&&(team||allocations.length||sh));
 const responseCard=hasResponse?`<div class="card" style="margin-top:14px"><div class="cardhead"><h3>Authority response for ${esc(assigned.id)}</h3><span>Live assignment</span></div><div class="body">
   <div class="mini"><div><small>STATUS</small><b>${esc(assigned.status)}</b></div><div><small>RESCUE TEAM</small><b>${esc(team||"Not assigned")}</b></div><div><small>SHELTER</small><b>${esc(sh?.name||"Not assigned")}</b></div><div><small>RESOURCES</small><b>${allocations.length}</b></div></div>
   ${team?`<div class="feature" style="margin-top:12px"><span>🚑 ${esc(team)} assigned</span></div>`:""}
   ${allocations.length?`<div style="margin-top:12px"><b style="font-size:10px">Allocated resources</b>${allocations.map(x=>`<div class="row" style="padding:8px 0"><div>📦 <b>${esc(x.resource)}</b></div><div>${x.quantity} ${esc(x.unit)}</div></div>`).join("")}</div>`:""}
   ${sh?`<div style="margin-top:10px"><b style="font-size:10px">Shelter</b><p style="font-size:9px;color:#718096;margin:5px 0">${esc(sh.name)} • ${esc(sh.area)} • ${free} spaces available</p></div>`:""}
 </div></div>`:`<div class="card" style="margin-top:14px"><div class="cardhead"><h3>Authority response</h3><span>Waiting for assignment</span></div><div class="body"><div class="empty">Once an authority assigns a rescue team, shelter or resources to your incident, the details will appear here automatically.</div></div></div>`;
 const assignedShelterText=sh?`${esc(sh.name)} • ${free} spaces available`:`No shelter assigned yet`;
 $("#dashboard").innerHTML=pageTop("Citizen Dashboard","Report emergencies, use voice assistance, share your location and access your assigned response support.",
 `<button class="btn secondary" data-page="map">📍 Map</button><button class="btn primary" data-page="report">＋ Emergency report</button>`)+
 `<div class="hero"><h2>Stay safe, stay informed.</h2><p>CrisisBridge connects your emergency report to the response network. If you are in immediate danger, use the emergency contact available on your device.</p></div>
 <div class="kpis">${kpi("ACTIVE COMMUNITY INCIDENTS",active,"Live workspace")}${kpi("MY REPORTS",myReports.length,"Tracked by incident ID")}${kpi("MY RESPONSE",hasResponse?"ASSIGNED":"PENDING","Authority coordination")}${kpi("GPS",state.gps?"READY":"OFF","Location sharing")}</div>
 <div class="layout2">
  <div class="card"><div class="cardhead"><h3>Quick access</h3><span>Citizen services</span></div><div class="body"><div class="quickgrid" style="margin:0">
   <button class="quick" data-page="report">🚨<b>Report Emergency</b><small>Flood, fire, medical, blockage…</small></button>
   <button class="quick" data-page="shelters">🏠<b>My / Assigned Shelter</b><small>${assignedShelterText}</small></button>
   <button class="quick" data-page="information">🛡️<b>Safety Information</b><small>Verified guidance</small></button>
  </div></div></div>
  <div class="card"><div class="cardhead"><h3>My response</h3><span>Authority allocation</span></div><div class="body"><h3 style="font-size:14px;margin:0 0 5px">${team?`🚑 ${esc(team)}`:`Waiting for rescue assignment`}</h3><p style="font-size:9px;color:#718096">${assigned?`${esc(assigned.id)} • ${esc(assigned.status)}`:`Create an emergency report to begin tracking.`}</p>${allocations.length?`<div class="feature" style="margin-top:10px">${allocations.map(x=>`<span>📦 ${esc(x.resource)}: ${x.quantity} ${esc(x.unit)}</span>`).join("")}</div>`:`<div class="feature" style="margin-top:10px"><span>📦 No resources allocated yet</span></div>`}</div></div>
 </div>
 ${responseCard}
 <div class="card" style="margin-top:14px"><div class="cardhead"><h3>My recent emergency reports</h3><span>Track status with incident ID</span></div><div class="body">${myReports.slice(0,4).map(i=>`<div class="row"><div><span class="id">${i.id}</span>${badge(i.severity)}</div><div><h4>${esc(i.type)}</h4><p>${esc(i.location)} • ${i.people} people${i.assignedTeam?` • 🚑 ${esc(i.assignedTeam)}`:""}${(i.resourcesAllocated||[]).length?` • 📦 ${(i.resourcesAllocated||[]).length} allocation(s)`:""}</p></div><div>${statBadge(i.status)}</div></div>`).join("")||'<div class="empty">No reports yet. Use Emergency Report to create one.</div>'}</div></div>`;
 bind();
 $("#voiceQuick")?.addEventListener("click",()=>{go("report");setTimeout(()=>$("#mic")?.click(),250)});
}
function volunteerDash(active){
 const assigned=state.incidents.filter(i=>i.status==="ASSIGNED"||i.status==="IN PROGRESS").length;
 $("#dashboard").innerHTML=pageTop("Volunteer Dashboard","See complete incident information, accept tasks, update availability and support field operations.",
 `<button class="btn secondary" data-page="map">📍 Nearby map</button><button class="btn primary" data-page="rescue">🚑 View tasks</button>`)+
 `<div class="hero"><h2>Ready to help, ${esc(state.user.name.split(" ")[0])}.</h2><p>Your verified skills are used to match you with incidents. Only accept tasks you can safely perform.</p></div>
 <div class="kpis">${kpi("ACTIVE INCIDENTS",active,"Full response feed")}${kpi("ASSIGNED / ACTIVE",assigned,"Field tasks")}${kpi("MY SKILLS",state.user.skills.length,"Verified profile skills")}${kpi("AVAILABILITY","ON","Ready for matching")}</div>
 <div class="layout2"><div class="card"><div class="cardhead"><h3>Priority incidents — full field information</h3><span>Authority-visible dataset</span></div><div class="body"><div class="list">${[...state.incidents].sort((a,b)=>score(b)-score(a)).slice(0,5).map(i=>`<div class="row"><div><span class="id">${i.id}</span><br>${badge(i.severity)}</div><div><h4>${esc(i.type)} • ${esc(i.location)}</h4><p>${esc(i.description)} • ${i.people} people • ${i.medical?"Medical involved":""}</p></div><strong class="priority">${score(i)}%</strong></div>`).join("")}</div></div></div>
 <div class="card"><div class="cardhead"><h3>My field profile</h3></div><div class="body"><div class="mini"><div><small>STATUS</small><b>AVAILABLE</b></div><div><small>AREA</small><b>${esc(state.user.area)}</b></div></div><h4 style="font-size:10px;margin:15px 0 7px">Skills</h4><div class="feature">${state.user.skills.map(s=>`<span>${esc(s)}</span>`).join("")}</div><button class="btn primary" style="margin-top:13px" data-page="volunteers">Update availability</button></div></div></div>
 <div class="card" style="margin-top:14px"><div class="cardhead"><h3>Live map</h3><span>Incidents + GPS</span></div><div class="body"><div id="volMap" class="map"></div></div></div>`;
 bind();initMap("volMap");
}
function authorityDash(active,critical){
 $("#dashboard").innerHTML=pageTop("Authority Command Centre","Complete operational view: incidents, people affected, GPS, verification, teams, volunteers, shelters, resources and AI recommendations.",
 `<button class="btn secondary" data-page="analytics">📊 Analytics</button><button class="btn primary" data-page="broadcast">📢 Broadcast alert</button>`)+
 `<div class="hero"><h2>Emergency operations centre</h2><p>All response data is visible to authorized authority users. AI scores are decision support; final verification and dispatch remain with human responders.</p></div>
 <div class="kpis">${kpi("ACTIVE INCIDENTS",active,"All registered incidents")}${kpi("CRITICAL",critical,"Immediate review")}${kpi("PEOPLE AFFECTED",state.incidents.reduce((a,i)=>a+(i.people||0),0),"Current incident feed")}${kpi("state.teams AVAILABLE",state.teams.filter(x=>x.status==="AVAILABLE").length,"Dispatch capacity")}</div>
 <div class="layout2"><div class="card"><div class="cardhead"><h3>Command map</h3><span>GPS + incident intelligence</span></div><div class="body"><div id="authorityMap" class="map"></div></div></div>
 <div class="card"><div class="cardhead"><h3>AI rescue priority</h3><span>Explainable scoring</span></div><div class="body"><div class="list">${[...state.incidents].sort((a,b)=>score(b)-score(a)).map(i=>`<div class="row"><div><span class="id">${i.id}</span><br>${badge(i.severity)}</div><div><h4>${esc(i.type)}</h4><p>${esc(i.location)} • ${i.people} people • ${i.verified?"Verified":"Pending"}</p></div><strong class="priority">${score(i)}%</strong></div>`).join("")}</div></div></div></div>
 <div class="layout3" style="margin-top:14px">
 <div class="card"><div class="cardhead"><h3>Rescue teams</h3></div><div class="body">${state.teams.map(x=>`<div class="row"><div><b class="id">${x.id}</b></div><div><h4>${x.name}</h4><p>${x.members} responders • ${x.vehicle}</p></div><span class="badge ${x.status==="AVAILABLE"?"low":"medium"}">${x.status}</span></div>`).join("")}</div></div>
 <div class="card"><div class="cardhead"><h3>Shelter capacity</h3></div><div class="body">${state.shelters.map(s=>`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:9px"><b>${s.name}</b><span>${s.capacity-s.occupied} free</span></div><div class="statbar" style="margin-top:6px"><i style="width:${Math.round(s.occupied/s.capacity*100)}%"></i></div></div>`).join("")}<button class="btn secondary" data-page="shelters">Manage shelters</button></div></div>
 <div class="card"><div class="cardhead"><h3>Resources</h3></div><div class="body">${state.resources.map(r=>`<div style="margin-bottom:11px"><div style="display:flex;justify-content:space-between;font-size:9px"><b>${r.name}</b><span>${r.available}/${r.required}</span></div><div class="statbar" style="margin-top:6px"><i style="width:${Math.round(r.available/r.required*100)}%"></i></div></div>`).join("")}<button class="btn secondary" data-page="resources">Open inventory</button></div></div>
 </div>
 <div class="card" style="margin-top:14px"><div class="cardhead"><h3>Complete incident feed</h3><span>Authority control</span></div><div class="body">${incidentTable(true)}</div></div>`;
 bind();initMap("authorityMap");
}
const EMERGENCY_TRANSLATIONS={
 en:{"help":"I need help","i need help":"I need help","please help me":"Please help me","send help":"Please send help","flood":"There is a flood","flood water is coming":"Flood water is coming","people are trapped":"People are trapped","medical emergency":"There is a medical emergency","we need medical help":"We need medical help","ambulance needed":"An ambulance is needed","fire":"There is a fire","there is a fire":"There is a fire","where is the shelter":"Where is the shelter","we need water":"We need water","we need food":"We need food","send my location":"Please send my location","i am safe":"I am safe","rescue team":"We need a rescue team"},
 ta:{"உதவி வேண்டும்":"I need help","எனக்கு உதவி வேண்டும்":"I need help","தயவுசெய்து உதவுங்கள்":"Please help me","காப்பாற்றுங்கள்":"Please rescue us","வெள்ளம்":"There is a flood","வெள்ளம் வந்துவிட்டது":"Flood water is coming","வெள்ள நீர் வருகிறது":"Flood water is coming","மக்கள் சிக்கியுள்ளனர்":"People are trapped","மருத்துவ அவசரம்":"There is a medical emergency","மருத்துவ உதவி வேண்டும்":"We need medical help","ஆம்புலன்ஸ் வேண்டும்":"An ambulance is needed","தீப்பிடித்துள்ளது":"There is a fire","தீ":"There is a fire","தங்குமிடம் எங்கே":"Where is the shelter","தண்ணீர் வேண்டும்":"We need water","உணவு வேண்டும்":"We need food","எனது இருப்பிடத்தை அனுப்புங்கள்":"Please send my location","நான் பாதுகாப்பாக இருக்கிறேன்":"I am safe","மீட்புக் குழு வேண்டும்":"We need a rescue team","குழந்தை சிக்கியுள்ளது":"A child is trapped","முதியவர் சிக்கியுள்ளார்":"An elderly person is trapped","பலர் சிக்கியுள்ளனர்":"Several people are trapped"},
 te:{"సహాయం కావాలి":"I need help","నాకు సహాయం కావాలి":"I need help","దయచేసి సహాయం చేయండి":"Please help me","కాపాడండి":"Please rescue us","వరద":"There is a flood","వరద నీరు వస్తోంది":"Flood water is coming","ప్రజలు చిక్కుకున్నారు":"People are trapped","వైద్య అత్యవసరం":"There is a medical emergency","వైద్య సహాయం కావాలి":"We need medical help","అంబులెన్స్ కావాలి":"An ambulance is needed","మంటలు ఉన్నాయి":"There is a fire","షెల్టర్ ఎక్కడ ఉంది":"Where is the shelter","నీరు కావాలి":"We need water","ఆహారం కావాలి":"We need food","నా లొకేషన్ పంపండి":"Please send my location","నేను సురక్షితంగా ఉన్నాను":"I am safe","రెస్క్యూ టీమ్ కావాలి":"We need a rescue team"},
 hi:{"मदद चाहिए":"I need help","मुझे मदद चाहिए":"I need help","कृपया मदद करें":"Please help me","बचाइए":"Please rescue us","बाढ़":"There is a flood","बाढ़ का पानी आ रहा है":"Flood water is coming","लोग फंसे हुए हैं":"People are trapped","चिकित्सा आपातकाल":"There is a medical emergency","चिकित्सा सहायता चाहिए":"We need medical help","एम्बुलेंस चाहिए":"An ambulance is needed","आग लगी है":"There is a fire","शेल्टर कहाँ है":"Where is the shelter","पानी चाहिए":"We need water","खाना चाहिए":"We need food","मेरी लोकेशन भेजें":"Please send my location","मैं सुरक्षित हूँ":"I am safe","बचाव दल चाहिए":"We need a rescue team"},
 kn:{"ಸಹಾಯ ಬೇಕು":"I need help","ನನಗೆ ಸಹಾಯ ಬೇಕು":"I need help","ದಯವಿಟ್ಟು ಸಹಾಯ ಮಾಡಿ":"Please help me","ರಕ್ಷಿಸಿ":"Please rescue us","ಪ್ರವಾಹ":"There is a flood","ಪ್ರವಾಹದ ನೀರು ಬರುತ್ತಿದೆ":"Flood water is coming","ಜನರು ಸಿಲುಕಿಕೊಂಡಿದ್ದಾರೆ":"People are trapped","ವೈದ್ಯಕೀಯ ತುರ್ತುಸ್ಥಿತಿ":"There is a medical emergency","ವೈದ್ಯಕೀಯ ಸಹಾಯ ಬೇಕು":"We need medical help","ಆಂಬ್ಯುಲೆನ್ಸ್ ಬೇಕು":"An ambulance is needed","ಬೆಂಕಿ ಕಾಣಿಸಿಕೊಂಡಿದೆ":"There is a fire","ಆಶ್ರಯ ಎಲ್ಲಿದೆ":"Where is the shelter","ನೀರು ಬೇಕು":"We need water","ಆಹಾರ ಬೇಕು":"We need food","ನನ್ನ ಸ್ಥಳ ಕಳುಹಿಸಿ":"Please send my location","ನಾನು ಸುರಕ್ಷಿತವಾಗಿದ್ದೇನೆ":"I am safe","ರಕ್ಷಣಾ ತಂಡ ಬೇಕು":"We need a rescue team"},
 ml:{"സഹായം വേണം":"I need help","എനിക്ക് സഹായം വേണം":"I need help","ദയവായി സഹായിക്കൂ":"Please help me","രക്ഷിക്കൂ":"Please rescue us","വെള്ളപ്പൊക്കം":"There is a flood","വെള്ളപ്പൊക്കം വരുന്നു":"Flood water is coming","ആളുകൾ കുടുങ്ങിയിരിക്കുന്നു":"People are trapped","മെഡിക്കൽ അടിയന്തരാവസ്ഥ":"There is a medical emergency","മെഡിക്കൽ സഹായം വേണം":"We need medical help","ആംബുലൻസ് വേണം":"An ambulance is needed","തീ പിടിച്ചു":"There is a fire","അഭയകേന്ദ്രം എവിടെയാണ്":"Where is the shelter","വെള്ളം വേണം":"We need water","ഭക്ഷണം വേണം":"We need food","എന്റെ സ്ഥാനം അയയ്ക്കൂ":"Please send my location","ഞാൻ സുരക്ഷിതനാണ്":"I am safe","രക്ഷാ സംഘം വേണം":"We need a rescue team"},
 bn:{"সাহায্য চাই":"I need help","আমার সাহায্য দরকার":"I need help","দয়া করে সাহায্য করুন":"Please help me","বন্যা":"There is a flood","বন্যার পানি আসছে":"Flood water is coming","মানুষ আটকে আছে":"People are trapped","চিকিৎসা জরুরি":"There is a medical emergency","চিকিৎসা সহায়তা দরকার":"We need medical help","অ্যাম্বুলেন্স দরকার":"An ambulance is needed","আগুন লেগেছে":"There is a fire","আশ্রয় কোথায়":"Where is the shelter","পানি দরকার":"We need water","খাবার দরকার":"We need food","আমার অবস্থান পাঠান":"Please send my location","আমি নিরাপদ":"I am safe","উদ্ধার দল দরকার":"We need a rescue team"},
 mr:{"मदत हवी":"I need help","मला मदत हवी आहे":"I need help","कृपया मदत करा":"Please help me","पूर":"There is a flood","पुराचे पाणी येत आहे":"Flood water is coming","लोक अडकले आहेत":"People are trapped","वैद्यकीय आणीबाणी":"There is a medical emergency","वैद्यकीय मदत हवी आहे":"We need medical help","रुग्णवाहिका हवी":"An ambulance is needed","आग लागली आहे":"There is a fire","निवारा कुठे आहे":"Where is the shelter","पाणी हवे":"We need water","अन्न हवे":"We need food","माझे स्थान पाठवा":"Please send my location","मी सुरक्षित आहे":"I am safe","बचाव पथक हवे":"We need a rescue team"},
 gu:{"મદદ જોઈએ":"I need help","મને મદદ જોઈએ":"I need help","કૃપા કરીને મદદ કરો":"Please help me","પૂર":"There is a flood","પૂરનું પાણી આવી રહ્યું છે":"Flood water is coming","લોકો ફસાયા છે":"People are trapped","તબીબી કટોકટી":"There is a medical emergency","તબીબી મદદ જોઈએ":"We need medical help","એમ્બ્યુલન્સ જોઈએ":"An ambulance is needed","આગ લાગી છે":"There is a fire","આશ્રય ક્યાં છે":"Where is the shelter","પાણી જોઈએ":"We need water","ખોરાક જોઈએ":"We need food","મારું સ્થાન મોકલો":"Please send my location","હું સુરક્ષિત છું":"I am safe","બચાવ ટીમ જોઈએ":"We need a rescue team"},
 pa:{"ਮਦਦ ਚਾਹੀਦੀ ਹੈ":"I need help","ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ":"I need help","ਕਿਰਪਾ ਕਰਕੇ ਮਦਦ ਕਰੋ":"Please help me","ਹੜ੍ਹ":"There is a flood","ਹੜ੍ਹ ਦਾ ਪਾਣੀ ਆ ਰਿਹਾ ਹੈ":"Flood water is coming","ਲੋਕ ਫਸੇ ਹੋਏ ਹਨ":"People are trapped","ਮੈਡੀਕਲ ਐਮਰਜੈਂਸੀ":"There is a medical emergency","ਮੈਡੀਕਲ ਮਦਦ ਚਾਹੀਦੀ ਹੈ":"We need medical help","ਐਂਬੂਲੈਂਸ ਚਾਹੀਦੀ ਹੈ":"An ambulance is needed","ਅੱਗ ਲੱਗ ਗਈ ਹੈ":"There is a fire","ਸ਼ੈਲਟਰ ਕਿੱਥੇ ਹੈ":"Where is the shelter","ਪਾਣੀ ਚਾਹੀਦਾ ਹੈ":"We need water","ਖਾਣਾ ਚਾਹੀਦਾ ਹੈ":"We need food","ਮੇਰਾ ਸਥਾਨ ਭੇਜੋ":"Please send my location","ਮੈਂ ਸੁਰੱਖਿਅਤ ਹਾਂ":"I am safe","ਬਚਾਅ ਟੀਮ ਚਾਹੀਦੀ ਹੈ":"We need a rescue team"},
 ur:{"مدد چاہیے":"I need help","مجھے مدد چاہیے":"I need help","براہ کرم مدد کریں":"Please help me","سیلاب":"There is a flood","سیلاب کا پانی آ رہا ہے":"Flood water is coming","لوگ پھنسے ہوئے ہیں":"People are trapped","طبی ایمرجنسی":"There is a medical emergency","طبی مدد چاہیے":"We need medical help","ایمبولینس چاہیے":"An ambulance is needed","آگ لگی ہے":"There is a fire","پناہ گاہ کہاں ہے":"Where is the shelter","پانی چاہیے":"We need water","کھانا چاہیے":"We need food","میری لوکیشن بھیجیں":"Please send my location","میں محفوظ ہوں":"I am safe","ریسکیو ٹیم چاہیے":"We need a rescue team"},
 or:{"ସାହାଯ୍ୟ ଦରକାର":"I need help","ମୋତେ ସାହାଯ୍ୟ ଦରକାର":"I need help","ଦୟାକରି ସାହାଯ୍ୟ କରନ୍ତୁ":"Please help me","ବନ୍ୟା":"There is a flood","ବନ୍ୟା ପାଣି ଆସୁଛି":"Flood water is coming","ଲୋକେ ଫସିଛନ୍ତି":"People are trapped","ଚିକିତ୍ସା ଜରୁରୀ":"There is a medical emergency","ଚିକିତ୍ସା ସାହାଯ୍ୟ ଦରକାର":"We need medical help","ଆମ୍ବୁଲାନ୍ସ ଦରକାର":"An ambulance is needed","ନିଆଁ ଲାଗିଛି":"There is a fire","ଆଶ୍ରୟ କେଉଁଠି":"Where is the shelter","ପାଣି ଦରକାର":"We need water","ଖାଦ୍ୟ ଦରକାର":"We need food","ମୋ ଅବସ୍ଥାନ ପଠାନ୍ତୁ":"Please send my location","ମୁଁ ସୁରକ୍ଷିତ":"I am safe","ଉଦ୍ଧାର ଦଳ ଦରକାର":"We need a rescue team"}
};
const SPEECH_LANG={en:'en-IN',ta:'ta-IN',te:'te-IN',hi:'hi-IN',kn:'kn-IN',ml:'ml-IN',bn:'bn-IN',mr:'mr-IN',gu:'gu-IN',pa:'pa-IN',ur:'ur-IN',or:'or-IN'};
const VOICE_LANGS=[['ta','Tamil'],['te','Telugu'],['hi','Hindi'],['kn','Kannada'],['ml','Malayalam'],['en','English'],['bn','Bengali'],['mr','Marathi'],['gu','Gujarati'],['pa','Punjabi'],['ur','Urdu'],['or','Odia']];
function normalizePhrase(v){return String(v||'').toLowerCase().replace(/[!?.,;:]/g,' ').replace(/\s+/g,' ').trim()}
function translateEmergencyText(text,lang){
  const clean=normalizePhrase(text); const dict=EMERGENCY_TRANSLATIONS[lang]||{};
  if(dict[clean]) return dict[clean];
  const keys=Object.keys(dict).sort((a,b)=>b.length-a.length);
  for(const k of keys){ if(clean.includes(normalizePhrase(k))) return dict[k]; }
  return lang==='en'?text:`${text} (Please review the original message; no exact offline emergency phrase match was found.)`;
}
function translateEnglishTo(text,target){
 const clean=normalizePhrase(text); if(target==='en')return text;
 const dict=EMERGENCY_TRANSLATIONS[target]||{};
 for(const [src,en] of Object.entries(dict)){if(normalizePhrase(en)===clean)return src;}
 return text;
}
function translateBetween(text,source,target){
 source=source||'en'; target=target||'en';
 if(source===target)return text;
 const english=source==='en'?text:translateEmergencyText(text,source);
 return target==='en'?english:translateEnglishTo(english,target);
}
async function prepareLocalSpeech(SR,lang){
  if(!SR)return false;
  try{
    if(typeof SR.available==='function'){
      const status=await SR.available({langs:[lang],processLocally:true});
      if(status==='available') return true;
      if((status==='downloadable'||status==='downloading') && typeof SR.install==='function'){
        try{ await SR.install({langs:[lang]}); return true; }catch(e){}
      }
    }
  }catch(e){}
  return false;
}
function setupEmergencyVoice(){
  const mic=$('#reportMic'), langSel=$('#voiceLang'), targetSel=$('#voiceTarget'), translateBtn=$('#translateVoice'), input=$('#voiceText'), output=$('#voiceTranslation'), desc=$('#rdesc'), status=$('#voiceStatus');
  if(!mic)return;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const setStatus=(m,good=false)=>{if(status){status.textContent=m;status.dataset.state=good?'ok':'info'}};
  const addTranslation=()=>{
    const txt=input?.value.trim();
    if(!txt){setStatus('Enter or speak an emergency message first.');toast('Enter or speak an emergency message first.');return false;}
    const source=langSel?.value||'en'; const target=targetSel?.value||'en';
    const out=translateBetween(txt,source,target);
    if(output)output.value=out;
    if(desc){
      const old=desc.value.trim();
      const line=source===target?out:`[${langSel?.selectedOptions?.[0]?.textContent||source} → ${targetSel?.selectedOptions?.[0]?.textContent||target}] ${out}`;
      desc.value=old?`${old}\n${line}`:line;
    }
    setStatus(`${targetSel?.selectedOptions?.[0]?.textContent||'Selected language'} translation added to the emergency description.`,true);
    return true;
  };
  translateBtn?.addEventListener('click',addTranslation);
  mic.addEventListener('click',async()=>{
    if(!SR){
      setStatus('This browser has no speech recognition. Type the message and use the offline phrasebook translator.');
      toast('Speech recognition is unavailable in this browser.');
      return;
    }
    const selected=langSel?.value||'en';
    const speechLocale=SPEECH_LANG[selected]||'en-IN';
    const localReady=await prepareLocalSpeech(SR,speechLocale);
    const r=new SR();
    r.lang=speechLocale; r.interimResults=false; r.maxAlternatives=3; r.continuous=false;
    if('processLocally' in r) r.processLocally=localReady;
    r.onstart=()=>{mic.disabled=true;mic.textContent='🎙️ Listening…';setStatus(`Listening in ${langSel?.selectedOptions?.[0]?.textContent||'selected language'}${localReady?' • offline':' • browser speech engine'}…`)};
    r.onresult=e=>{
      const txt=e.results?.[0]?.[0]?.transcript||'';
      if(input)input.value=txt;
      addTranslation();
    };
    r.onerror=e=>{
      const code=e.error||'unknown';
      let msg='Voice input could not start. You can type the message below and translate it offline.';
      if(code==='language-not-supported'){
        const label=langSel?.selectedOptions?.[0]?.textContent||'selected language';
        msg=`${label} is not available in this browser speech engine. For guaranteed offline voice, an on-device speech model must be installed on this device.`;
      }else if(code==='network'){
        msg='The browser speech engine needs an online service. Offline translation still works for typed/native-language messages.';
      }else if(code==='not-allowed'){
        msg='Microphone permission was denied. Allow microphone access and try again.';
      }
      setStatus(msg);
      if(code==='not-allowed') toast('Allow microphone permission and try again.');
    };
    r.onend=()=>{mic.disabled=false;mic.textContent='🎙️ Speak emergency';};
    try{r.start();}catch(err){mic.disabled=false;mic.textContent='🎙️ Speak emergency';setStatus('Could not start the microphone. Check microphone permission and try again.');}
  });
  input?.addEventListener('input',()=>{if(output)output.value='';});
  targetSel?.addEventListener('change',()=>{if(input?.value.trim())setStatus('Target language changed. Press Translate to update the result.')});
}

function report(){
 $("#report").innerHTML=pageTop("Emergency Report","Create a structured incident with GPS, severity, people and medical details.",
 `<button class="btn secondary" data-page="incidents">View my reports</button>`)+
 `<div class="layout2"><div class="card"><div class="cardhead"><h3>Incident details</h3><span>Submit → verify → assign → resolve</span></div><div class="body">
 <div class="grid"><div class="field"><label>Emergency type *<select id="rtype"><option>Flood Rescue</option><option>Fire</option><option>Medical Emergency</option><option>Road Blockage</option><option>Missing Person</option><option>Shelter Request</option><option>Food / Water Shortage</option><option>Other</option></select></label></div>
 <div class="field"><label>Severity *<select id="rseverity"><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div></div>
 <div class="grid"><div class="field"><label>People affected<input id="rpeople" type="number" min="0" value="1"></label></div><div class="field"><label>Location / landmark *<input id="rlocation" value="${esc(state.user.area)}" placeholder="Street / landmark / village"></label></div></div>
 <div class="field"><label>Description<textarea id="rdesc" placeholder="Explain what happened, who needs help and what responders should know."></textarea></label></div>
 <div class="voicebox" id="citizenVoiceReportBox">
  <div class="cardhead"><h3>🎙️ Quick voice emergency report</h3><span>Record instead of typing</span></div>
  <p style="font-size:10px;color:#718096;margin:0 0 10px">Briefly describe the danger, exact location and people needing help. The recording is saved locally with your report for the authority to review.</p>
  <div class="voiceactions"><button type="button" class="btn primary" id="citizenRecordReport">🔴 Record voice report</button><button type="button" class="btn secondary" id="citizenStopReport" disabled>⏹ Stop recording</button><button type="button" class="btn secondary" id="citizenRemoveReportVoice" hidden>Remove recording</button></div>
  <div id="citizenReportAudioPreview" style="margin-top:10px"></div><small id="citizenReportVoiceStatus">Microphone permission is required. Keep your report short (about 30 seconds).</small>
 </div>
 <div class="voicebox">
  <div class="cardhead"><h3>🎙️ Voice &amp; Language Translation</h3><span>English interface • 12 languages • offline phrasebook</span></div>
  <div class="grid">
   <div class="field"><label>Input language<select id="voiceLang">${VOICE_LANGS.map(x=>`<option value="${x[0]}" ${x[0]==='ta'?'selected':''}>${x[1]}</option>`).join('')}</select></label></div>
   <div class="field"><label>Translate to<select id="voiceTarget">${VOICE_LANGS.map(x=>`<option value="${x[0]}" ${x[0]==='en'?'selected':''}>${x[1]}</option>`).join('')}</select></label></div>
  </div>
  <div class="field" style="margin-top:10px"><label>Voice / message<textarea id="voiceText" rows="2" placeholder="Speak or type the emergency message in the selected language"></textarea></label></div>
  <div class="voiceactions"><button type="button" class="btn secondary" id="reportMic">🎙️ Speak emergency</button><button type="button" class="btn primary" id="translateVoice">Translate &amp; add to description</button></div>
  <small id="voiceStatus">Choose an input and target language. Voice recognition uses the device/browser speech engine when available; the translation phrasebook works offline.</small>
  <div class="field" style="margin-top:10px"><label>Translated emergency message<textarea id="voiceTranslation" rows="2" readonly placeholder="Translation will appear here"></textarea></label></div>
 </div> </div>
 <div class="gps"><div><b>📍 Current GPS</b><small id="gpstext">${state.gps?`Lat ${state.gps.lat.toFixed(6)}, Lng ${state.gps.lng.toFixed(6)} • ${state.gps.accuracy}m accuracy`:"Not captured"}</small></div><button class="btn secondary" id="getGps">Use GPS</button></div>
 <label class="check" style="margin-top:12px"><input type="checkbox" id="rmedical"> Medical emergency / injury involved</label>
 <div class="grid" style="margin-top:12px"><div class="field"><label>Vulnerability<select id="rvulnerability"><option value="none">None reported</option><option value="child">Child involved</option><option value="elderly">Elderly person</option><option value="pregnant">Pregnant person</option><option value="disability">Person with disability</option><option value="multiple">Multiple vulnerable people</option></select></label></div><div class="field"><label>Required response skill<select id="rskill"><option>Search & Rescue</option><option>First Aid</option><option>Water Rescue</option><option>Fire Response</option><option>Medical</option><option>Logistics</option></select></label></div></div>
 <div class="field" style="margin-top:10px"><label>Evidence photo <input id="revidence" type="file" accept="image/*"></label><small style="color:#718096">Stored locally on this device for offline verification.</small></div>
 </div><div class="modalfoot"><button class="btn secondary" id="clearReport">Clear</button><button class="btn primary" id="submitReport">Submit emergency report →</button></div></div>
 <div><div class="card"><div class="cardhead"><h3>How CrisisBridge responds</h3></div><div class="body"><div class="list"><div class="row"><b>01</b><div><h4>Capture</h4><p>GPS + emergency details</p></div></div><div class="row"><b>02</b><div><h4>Store</h4><p>Offline browser storage if connection drops</p></div></div><div class="row"><b>03</b><div><h4>Prioritize</h4><p>AI-style score considers severity, people, medical need and verification</p></div></div><div class="row"><b>04</b><div><h4>Coordinate</h4><p>Authority assigns rescue, volunteers and shelter support</p></div></div></div></div></div>
 <div class="card" style="margin-top:13px"><div class="cardhead"><h3>Immediate external help</h3></div><div class="body"><div style="font-size:26px;font-weight:900">112</div><p style="font-size:9px;color:#718096">For immediate danger, use your phone's emergency calling facility.</p><button class="btn primary" id="call112">☎ Call 112</button></div></div></div></div>`;
 $("#getGps").onclick=()=>gps(true);$("#submitReport").onclick=submitReport;$("#clearReport").onclick=()=>{$("#rdesc").value="";$("#rpeople").value=1;clearCitizenReportVoice()};$("#call112").onclick=()=>location.href="tel:112"
 setupEmergencyVoice();
 setupCitizenVoiceReport();
 if(!state.gps)gps(false);
}
let citizenReportRecorder=null,citizenReportChunks=[];
function clearCitizenReportVoice(){
 if(citizenReportRecorder?.state==='recording'){try{citizenReportRecorder.stop()}catch{}}
 if(pendingReportAudioKey){VoiceCache.del(pendingReportAudioKey);AudioStore.del(pendingReportAudioKey)}
 pendingReportAudioKey=null;citizenReportRecorder=null;citizenReportChunks=[];
 const preview=$("#citizenReportAudioPreview"),status=$("#citizenReportVoiceStatus"),remove=$("#citizenRemoveReportVoice");
 if(preview)preview.innerHTML='';if(status)status.textContent='Microphone permission is required. Keep your report short (about 30 seconds).';if(remove)remove.hidden=true;
 const rec=$("#citizenRecordReport"),stop=$("#citizenStopReport");if(rec)rec.disabled=false;if(stop)stop.disabled=true;
}
function setupCitizenVoiceReport(){
 const rec=$("#citizenRecordReport"),stop=$("#citizenStopReport"),status=$("#citizenReportVoiceStatus"),preview=$("#citizenReportAudioPreview"),remove=$("#citizenRemoveReportVoice");
 if(!rec||!stop)return;
 rec.onclick=async()=>{
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){if(status)status.textContent='Voice recording is not supported in this browser. You can still type your report.';return toast('Voice recording is not supported in this browser.')}
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(x=>MediaRecorder.isTypeSupported?.(x))||'';
   citizenReportChunks=[];citizenReportRecorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
   const activeRecorder=citizenReportRecorder;
   activeRecorder.ondataavailable=e=>{if(e.data?.size)citizenReportChunks.push(e.data)};
   activeRecorder.onstop=async()=>{
    stream.getTracks().forEach(t=>t.stop());
    const blob=new Blob(citizenReportChunks,{type:activeRecorder.mimeType||'audio/webm'});
    if(!blob.size){if(status)status.textContent='No audio was captured. Please try again or type your report.';rec.disabled=false;stop.disabled=true;return}
    pendingReportAudioKey='citizen-report-'+Date.now();
    try{await AudioStore.put(pendingReportAudioKey,blob)}catch(e){}
    await VoiceCache.put(pendingReportAudioKey,blob);
    const url=URL.createObjectURL(blob);
    if(preview)preview.innerHTML=`<div class="audio-recorded"><b>✓ Voice report ready</b><audio controls src="${url}" style="width:100%;margin-top:8px"></audio></div>`;
    if(status)status.textContent='Voice saved. Submit the emergency report to attach it for authority review.';
    if(remove)remove.hidden=false;rec.disabled=false;stop.disabled=true;citizenReportRecorder=null;
   };
   activeRecorder.start();rec.disabled=true;stop.disabled=false;if(status)status.textContent='Recording… Clearly say what happened, your location and how many people need help.';
  }catch(e){if(status)status.textContent='Microphone access was denied or unavailable. Allow microphone access, or type your report.';toast('Allow microphone access to record your emergency report.')}
 };
 stop.onclick=()=>{if(citizenReportRecorder?.state==='recording')citizenReportRecorder.stop()};
 remove.onclick=()=>clearCitizenReportVoice();
}

function gps(show){
 if(!navigator.geolocation)return toast("Browser GPS is unavailable.");
 navigator.geolocation.getCurrentPosition(p=>{state.gps={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:Math.round(p.coords.accuracy)};save();let x=$("#gpstext");if(x)x.textContent=`Lat ${state.gps.lat.toFixed(6)}, Lng ${state.gps.lng.toFixed(6)} • ${state.gps.accuracy}m accuracy`;toast("GPS location captured.");},()=>toast("Location permission denied or unavailable."),{enableHighAccuracy:true,timeout:12000,maximumAge:5000});
}
function submitReport(){
 const btn=$("#submitReport");
 if(btn?.dataset.busy==="1")return;
 const location=$("#rlocation")?.value.trim();
 if(!location){toast("Please enter a location or landmark.");$("#rlocation")?.focus();return;}
 const people=Math.max(0,Number($("#rpeople")?.value||0));
 const description=$("#rdesc")?.value.trim();
 if(!description&&!pendingReportAudioKey){toast("Please type a description or record a voice emergency report.");$("#rdesc")?.focus();return;}
 if(!state.user){toast("Please login before submitting an emergency report.");return;}
 if(btn) {btn.dataset.busy="1";btn.disabled=true;btn.textContent="Saving emergency report…";}
 const now=new Date().toISOString();
 const id="CB-"+Math.floor(1000+Math.random()*8999);
 const i={id,type:$("#rtype")?.value||"Other",severity:$("#rseverity")?.value||"high",people,location,description:description||"Voice emergency report attached. Please listen to the recording for details.",audioKey:pendingReportAudioKey||null,lat:state.gps?.lat||12.7409,lng:state.gps?.lng||77.8253,status:"OPEN",reportedBy:roleLabel(state.user.role),reporterId:state.user.id,reporterEmail:state.user.email,time:"just now",createdAt:now,updatedAt:now,verified:false,medical:$("#rmedical")?.checked||false,vulnerability:$("#rvulnerability")?.value||"none",requiredSkill:$("#rskill")?.value||"Search & Rescue",timeline:[{at:now,action:"Incident created",by:state.user.name}],evidence:null};
 // Save the incident immediately. Evidence is optional and must never block the emergency submission.
 state.incidents.unshift(i);
 pendingReportAudioKey=null;
 state.notifications.unshift({title:"Emergency report created",text:`${id} submitted from ${location}.`,time:"just now",userId:state.user.id});
 addAudit("CREATE_INCIDENT",id,`Report created by ${state.user.name}`);
 const saved=save();
 // Queue a best-effort LAN relay. If there is no local relay, the report remains saved on this device.
 publishIncidentToLAN(i).then(remote=>{if(remote?.incident){const idx=state.incidents.findIndex(x=>x.id===i.id);if(idx>=0){state.incidents[idx]={...state.incidents[idx],updatedAt:remote.incident.updatedAt||i.updatedAt};save();}}});
 const file=$("#revidence")?.files?.[0];
 const finish=()=>{
   if(btn){btn.dataset.busy="0";btn.disabled=false;btn.textContent="Submit emergency report →";}
   toast(saved?`${id} submitted successfully.`:`${id} created. Local storage is full; keep this session open.`);
   go("incidents");
 };
 if(file){
   compressImage(file).then(data=>{i.evidence=data;save();finish();}).catch(()=>finish());
 }else finish();
}
function addAudit(action,incidentId,details){state.auditLogs=state.auditLogs||[];state.auditLogs.unshift({id:"A"+Date.now(),action,incidentId,details,by:state.user?.name||"System",at:new Date().toISOString()});if(state.auditLogs.length>300)state.auditLogs.length=300;save();}
function compressImage(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const max=900,scale=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.round(im.width*scale);c.height=Math.round(im.height*scale);c.getContext("2d").drawImage(im,0,0,c.width,c.height);resolve(c.toDataURL("image/jpeg",.65))};im.onerror=reject;im.src=r.result};r.onerror=reject;r.readAsDataURL(file)})}

function incidentTable(authority=false){
 return `<div class="tablewrap"><table class="table"><thead><tr><th>ID</th><th>Emergency</th><th>Severity</th><th>People</th><th>Location</th><th>Reporter</th><th>Verification</th><th>Status</th><th>AI</th><th></th></tr></thead><tbody>${state.incidents.map(i=>`<tr><td><b>${i.id}</b><br><small>${i.time}</small></td><td>${esc(i.type)}<br><small>${i.audioKey?"🎙️ Voice report attached • ":""}${i.medical?"Medical involved":"—"}</small></td><td>${badge(i.severity)}</td><td>${i.people}</td><td>${esc(i.location)}<br><small>${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}</small></td><td>${esc(i.reportedBy)}</td><td>${i.verified?badge("verified"):"Pending"}</td><td>${authority?`<select class="statusSelect" data-id="${i.id}"><option>OPEN</option><option>VERIFIED</option><option>ASSIGNED</option><option>IN PROGRESS</option><option>RESOLVED</option></select>`:statBadge(i.status)}</td><td><b>${score(i)}%</b></td><td>${authority?`<button class="btn secondary verifyBtn" data-id="${i.id}">${i.verified?"Verified":"Verify"}</button>`:""} <button class="btn secondary view" data-id="${i.id}">View</button></td></tr>`).join("")}</tbody></table></div>`;
}
function incidents(){
 const authority=state.user.role==="authority";
 const citizen=state.user.role==="citizen";
 $("#incidents").innerHTML=pageTop("Incidents",authority?"Full incident intelligence and authority controls.":citizen?"Track only your emergency reports and their response status.":"Full operational incident information for field response.",
 `<button class="btn secondary" id="refresh">↻ Refresh</button>${!authority?`<button class="btn primary" data-page="report">＋ Report</button>`:""}`)+
 `<div class="card"><div class="body"><div class="filters"><input id="search" placeholder="Search ID, type, location…"><select id="sev"><option value="">All severity</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><select id="status"><option value="">All status</option><option>OPEN</option><option>VERIFIED</option><option>ASSIGNED</option><option>IN PROGRESS</option><option>RESOLVED</option></select></div><div id="table"></div></div></div>`;
 const draw=()=>{let q=($("#search").value||"").toLowerCase(),s=$("#sev").value,st=$("#status").value;let source=citizen?state.incidents.filter(i=>i.reporterId===state.user.id||i.reporterEmail===state.user.email):state.incidents;let rows=source.filter(i=>(!q||`${i.id} ${i.type} ${i.location}`.toLowerCase().includes(q))&&(!s||i.severity===s)&&(!st||i.status===st));let old=state.incidents;state.incidents=rows;$("#table").innerHTML=incidentTable(authority);state.incidents=old;bindIncidentActions(authority)};
 ["search","sev","status"].forEach(x=>$("#"+x).addEventListener("input",draw));draw();$("#refresh").onclick=()=>{toast("Incident feed refreshed.");draw()};
}
function bindIncidentActions(authority){
 $$(".view").forEach(b=>b.onclick=()=>openIncident(b.dataset.id));
 $$(".statusSelect").forEach(s=>{let i=state.incidents.find(x=>x.id===s.dataset.id);if(i)s.value=i.status;s.onchange=()=>{const old=i.status;i.status=s.value;if(s.value==="VERIFIED")i.verified=true;i.timeline=i.timeline||[];i.timeline.push({at:new Date().toISOString(),action:`Status changed: ${old} → ${i.status}`,by:state.user.name});addAudit("STATUS_CHANGE",i.id,`${old} → ${i.status}`);save();state.notifications.unshift({title:"Incident status updated",text:`${i.id} is now ${i.status}.`,time:"just now"});renderNotifications();toast(`${i.id} → ${i.status}`);incidents()}});
 $$(".verifyBtn").forEach(b=>b.onclick=()=>{let i=state.incidents.find(x=>x.id===b.dataset.id);if(!i)return;i.verified=true;if(i.status==="OPEN")i.status="VERIFIED";i.timeline=i.timeline||[];i.timeline.push({at:new Date().toISOString(),action:"Incident verified",by:state.user.name});addAudit("VERIFY_INCIDENT",i.id,"Incident verified by authority");save();state.notifications.unshift({title:"Incident verified",text:`${i.id} verified by authority.`,time:"just now",userId:i.reporterId||null});renderNotifications();toast(`${i.id} verified.`);incidents()});
}
function openIncident(id){
 const i=state.incidents.find(x=>x.id===id);if(!i)return;
 const allocated=(i.resourcesAllocated||[]).map(x=>`${x.quantity} ${esc(x.unit)} ${esc(x.resource)}`).join(", ")||"None";
 openModal(`<div class="modalhead"><h3>${esc(i.id)} • ${esc(i.type)}</h3><button class="icon close">×</button></div><div class="modalbody">
 <div class="mini"><div><small>AI PRIORITY</small><b>${score(i)}%</b></div><div><small>PEOPLE</small><b>${i.people}</b></div><div><small>SEVERITY</small><b>${i.severity.toUpperCase()}</b></div><div><small>STATUS</small><b>${i.status}</b></div></div>
 <p style="font-size:10px;line-height:1.7;color:#657084;margin-top:14px">${esc(i.description)}</p>
 ${i.audioKey?`<div class="voicebox" style="margin-top:10px"><b>🎙️ Citizen voice report</b><p style="font-size:10px;color:#718096">Listen to the citizen's recorded emergency details.</p><button class="btn primary" id="playCitizenReportVoice">▶ Play voice report</button><div id="citizenAuthorityAudioPlayer" style="margin-top:8px"></div></div>`:''}
 <p style="font-size:9px;color:#657084">📍 ${esc(i.location)} • ${i.lat.toFixed(5)}, ${i.lng.toFixed(5)} • Reporter: ${esc(i.reportedBy)}</p>
 <div class="feature" style="margin-top:10px"><span>Verification: ${i.verified?"✓ Verified":"Pending"}</span><span>Medical: ${i.medical?"Yes":"No"}</span><span>Team: ${esc(i.assignedTeam||"Not assigned")}</span></div>
 <div class="card" style="box-shadow:none;margin-top:12px"><div class="body"><b style="font-size:10px">AI recommendation</b><p style="font-size:9px;color:#657084">Prioritize based on ${i.severity} severity, ${i.people} people affected, ${i.medical?"medical need, ":""}and ${i.verified?"verified":"pending"} verification. Recommended action: ${i.severity==="critical"?"immediate rescue + medical support":i.severity==="high"?"urgent field assessment":"nearest available response team"}.</p></div></div>
 <p style="font-size:9px;color:#657084;margin-top:10px"><b>Allocated resources:</b> ${allocated}</p><div class="card" style="box-shadow:none;margin-top:12px"><div class="body"><b style="font-size:10px">Incident timeline</b>${(i.timeline||[]).slice().reverse().slice(0,8).map(x=>`<div class="row"><div><span class="badge low">✓</span></div><div><h4>${esc(x.action)}</h4><p>${esc(x.by||"System")}</p></div><small>${new Date(x.at).toLocaleString()}</small></div>`).join("")||"<div class=empty>No timeline events yet.</div>"}</div></div>${i.evidence?`<div class="card" style="box-shadow:none;margin-top:12px"><div class="body"><b style="font-size:10px">Evidence</b><img src="${i.evidence}" alt="Incident evidence" style="width:100%;max-height:260px;object-fit:contain;margin-top:10px;border-radius:10px;background:#f4f7fb"></div></div>`:""}
 </div><div class="modalfoot">${state.user.role==="authority"?`<button class="btn secondary" id="verifyIncident">${i.verified?"✓ Verified":"✓ Verify"}</button><button class="btn secondary" id="assignIncident">🚑 Assign rescue</button><button class="btn secondary" id="shelterIncident">🏠 Allocate shelter</button><button class="btn primary" id="resourceIncident">📦 Allocate resource</button>`:""}<button class="btn secondary close">Close</button></div>`);
 $$(".close").forEach(x=>x.onclick=closeModal);
 $("#playCitizenReportVoice")?.addEventListener("click",async()=>{
  const box=$("#citizenAuthorityAudioPlayer");if(!box)return;
  let src=VoiceCache.get(i.audioKey);
  if(!src){const blob=await AudioStore.get(i.audioKey);if(blob)src=URL.createObjectURL(blob)}
  if(!src){toast("Voice report audio is unavailable in this browser. The text report is still saved.");return}
  box.innerHTML=`<audio controls autoplay style="width:100%" src="${src}"></audio>`;
 });
 $("#verifyIncident")?.addEventListener("click",()=>{i.verified=true;if(i.status==="OPEN")i.status="VERIFIED";i.timeline=i.timeline||[];i.timeline.push({at:new Date().toISOString(),action:"Incident verified",by:state.user.name});addAudit("VERIFY_INCIDENT",i.id,"Incident verified by authority");save();closeModal();toast(`${i.id} verified.`);incidents()});
 $("#assignIncident")?.addEventListener("click",()=>{closeModal();dispatchModal(i.id)});
 $("#resourceIncident")?.addEventListener("click",()=>{state.pendingResourceIncident=i.id;closeModal();go("resources")});
 $("#shelterIncident")?.addEventListener("click",()=>{let choices=state.shelters.map((s,n)=>`<option value="${n}">${esc(s.name)} — ${Math.max(0,s.capacity-s.occupied)} spaces</option>`).join("");openModal(`<div class="modalhead"><h3>Allocate shelter for ${esc(i.id)}</h3><button class="icon close">×</button></div><div class="modalbody"><div class="field"><label>Shelter<select id="ishelter">${choices}</select></label></div><div class="field"><label>People to allocate<input id="ipeople" type="number" min="1" max="${i.people||1}" value="1"></label></div></div><div class="modalfoot"><button class="btn secondary close">Cancel</button><button class="btn primary" id="confirmShelter">Allocate shelter</button></div>`);$$(".close").forEach(x=>x.onclick=closeModal);$("#confirmShelter").onclick=()=>{let n=Number($("#ishelter").value),s=state.shelters[n],q=Math.max(1,Number($("#ipeople").value||1));if(s.capacity-s.occupied<q)return toast("Not enough shelter capacity.");s.occupied+=q;i.assignedShelter=n;i.shelterPeople=q;i.timeline=i.timeline||[];i.timeline.push({at:new Date().toISOString(),action:`Shelter allocated: ${s.name}`,by:state.user.name});addAudit("ALLOCATE_SHELTER",i.id,`${q} person(s) → ${s.name}`);
 if(i.reporterId){let users=S.get("cb_users",USERS);let u=users.find(x=>x.id===i.reporterId||x.email===i.reporterEmail);if(u){u.assignedShelter=n;S.set("cb_users",users);}}
 state.notifications.unshift({title:"Shelter allocated",text:`${s.name} allocated for ${i.id}.`,time:"just now",userId:i.reporterId||null});save();closeModal();shelters();renderNotifications();toast("Shelter allocated successfully.")}});
}
function mapPage(){
 $("#map").innerHTML=pageTop("Live Map","OpenStreetMap visualization of incidents, shelters and your current GPS.",
 `<button class="btn secondary" id="center">📍 Center on me</button><button class="btn primary" id="refreshMap">↻ Refresh</button>`)+
 `<div class="card"><div class="body"><div id="fullMap" class="map large-map"></div></div></div>`;
 initMap("fullMap");$("#center").onclick=()=>{gps(true);setTimeout(()=>state.map?.setView([state.gps.lat,state.gps.lng],15),700)};$("#refreshMap").onclick=()=>{mapPage();toast("Map refreshed.")};
}
let mapInstances=[];
function initMap(id){
 const el=$("#"+id);if(!el)return;setTimeout(()=>{
  if(typeof L!=="undefined"){
   const map=L.map(el).setView(state.gps?[state.gps.lat,state.gps.lng]:[12.7409,77.8253],12);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map);
   state.incidents.forEach(i=>L.circleMarker([i.lat,i.lng],{radius:i.severity==="critical"?10:7,color:i.severity==="critical"?"#df3540":i.severity==="high"?"#d98300":"#149447",fillOpacity:.85}).addTo(map).bindPopup(`<b>${i.id}</b><br>${esc(i.type)}<br>${esc(i.location)}<br>${i.people} people • ${i.status}`));
   state.shelters.forEach(s=>L.marker([s.lat,s.lng]).addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>${s.capacity-s.occupied} spaces available`));
   if(state.gps)L.circleMarker([state.gps.lat,state.gps.lng],{radius:8,color:"#0b67f0",fillColor:"#0b67f0",fillOpacity:.9}).addTo(map).bindPopup("<b>Your current GPS</b>");state.map=map;return;
  }
  const pts=state.incidents.map(i=>({lat:i.lat,lng:i.lng,label:i.id,type:"incident",sev:i.severity})),shelters=state.shelters.map(x=>({lat:x.lat,lng:x.lng,label:x.name,type:"shelter"})),all=pts.concat(shelters);const minLat=all.length?Math.min(...all.map(x=>x.lat))-.02:12.58,maxLat=all.length?Math.max(...all.map(x=>x.lat))+.02:12.78,minLng=all.length?Math.min(...all.map(x=>x.lng))-.02:77.78,maxLng=all.length?Math.max(...all.map(x=>x.lng))+.02:77.88;
  const marker=p=>{const x=((p.lng-minLng)/(maxLng-minLng))*100,y=(1-(p.lat-minLat)/(maxLat-minLat))*100,cls=p.type==="shelter"?"map-pin shelter-pin":p.type==="gps"?"map-pin gps-pin":p.sev==="critical"?"map-pin critical-pin":p.sev==="high"?"map-pin high-pin":"map-pin";return `<button class="${cls}" style="left:${x}%;top:${y}%" title="${esc(p.label)}">${p.type==="shelter"?"⌂":p.type==="gps"?"📍":"●"}<span>${esc(p.label)}</span></button>`};
  el.innerHTML=`<div class="offline-map"><div class="map-grid"></div><div class="map-label">OFFLINE OPERATIONS MAP</div><div class="map-legend"><span>🔴 Critical</span><span>🟠 High</span><span>🟢 Other</span><span>🏠 Shelter</span></div>${all.map(marker).join('')}${state.gps?marker({lat:state.gps.lat,lng:state.gps.lng,label:"Your GPS",type:"gps"}):''}</div>`;
 },30)
}

function rescue(){
 $("#rescue").innerHTML=pageTop("Rescue Teams","Authority dispatch and response-status control.",`<button class="btn secondary" id="restoreTeams">↻ Restore dispatch capacity</button><button class="btn primary" id="dispatch">＋ Dispatch team</button>`);
 $("#rescue").innerHTML+=`<div class="layout3">${state.teams.map(x=>`<div class="card"><div class="body"><div style="display:flex;justify-content:space-between"><b class="id">${x.id}</b><span class="badge ${x.status==="AVAILABLE"?"low":"medium"}">${x.status}</span></div><h3 style="font-size:14px;margin:12px 0 4px">${esc(x.name)}</h3><p style="font-size:9px;color:#718096">${x.members} responders • ${esc(x.vehicle)} • ${esc(x.area)} • ETA ${esc(x.eta)}</p><button class="btn secondary" style="width:100%" data-team="${x.id}">Open team</button></div></div>`).join("")}</div>
 <div class="card" style="margin-top:14px"><div class="cardhead"><h3>Rescue assignments</h3><span>Choose incident + available team</span></div><div class="body">${state.incidents.filter(i=>i.status!=="RESOLVED").sort((a,b)=>score(b)-score(a)).map(i=>`<div class="row"><div>${badge(i.severity)}</div><div><h4>${i.id} • ${esc(i.type)}</h4><p>${esc(i.location)} • ${i.people} people • ${i.medical?"medical":"general"} • ${i.verified?"verified":"pending"}${i.assignedTeam?" • "+esc(i.assignedTeam):""}</p></div><button class="btn primary assign" data-id="${i.id}">${i.assignedTeam?"Reassign":"Assign"}</button></div>`).join("")||'<div class="empty">No active incidents.</div>'}</div></div>`;
 $("#restoreTeams").onclick=()=>{const a=state.teams.find(t=>t.id==="RT-04")||state.teams[0];const w=state.teams.find(t=>t.id==="RT-11");if(a){a.status="AVAILABLE";a.eta="—"}if(w&&w!==a){w.status="STANDBY";w.eta="18 min"}save();rescue();toast("Demo dispatch capacity restored.")};
 $("#dispatch").onclick=()=>dispatchModal();
 $$("[data-team]").forEach(b=>b.onclick=()=>{let t=state.teams.find(x=>x.id===b.dataset.team);openModal(`<div class="modalhead"><h3>${esc(t.id)} • ${esc(t.name)}</h3><button class="icon close">×</button></div><div class="modalbody"><div class="mini"><div><small>MEMBERS</small><b>${t.members}</b></div><div><small>VEHICLE</small><b>${esc(t.vehicle)}</b></div><div><small>STATUS</small><b>${esc(t.status)}</b></div><div><small>ETA</small><b>${esc(t.eta)}</b></div></div><p style="font-size:9px;color:#718096;margin-top:14px">Team area: ${esc(t.area)}</p></div><div class="modalfoot"><select id="teamStatus" style="padding:8px;border:1px solid #dfe5ec;border-radius:8px"><option>AVAILABLE</option><option>DEPLOYED</option><option>STANDBY</option></select><button class="btn primary" id="saveTeamStatus">Save status</button><button class="btn secondary close">Close</button></div>`);$$(".close").forEach(x=>x.onclick=closeModal);$("#teamStatus").value=t.status;$("#saveTeamStatus").onclick=()=>{t.status=$("#teamStatus").value;save();closeModal();rescue();toast(`${t.name} status updated.`)}});
 $$(".assign").forEach(b=>b.onclick=()=>dispatchModal(b.dataset.id));
}
function dispatchModal(preselect){
 const available=state.teams.map((t,i)=>({t,i})).filter(x=>["AVAILABLE","STANDBY"].includes(x.t.status)).sort((a,b)=>(a.t.status==="AVAILABLE"?0:1)-(b.t.status==="AVAILABLE"?0:1));
 const active=state.incidents.filter(i=>i.status!=="RESOLVED");
 if(!available.length)return toast("No dispatchable rescue team is available. Open a team and return it to AVAILABLE.");
 openModal(`<div class="modalhead"><h3>Dispatch rescue team</h3><button class="icon close">×</button></div><div class="modalbody"><div class="field"><label>Incident<select id="dispatchIncident">${active.map(i=>`<option value="${esc(i.id)}" ${i.id===preselect?"selected":""}>${esc(i.id)} • ${esc(i.type)} • ${esc(i.location)}</option>`).join("")}</select></label></div><div class="field"><label>Available team<select id="dispatchTeam">${available.map(x=>`<option value="${x.i}">${esc(x.t.id)} • ${esc(x.t.name)} • ${x.t.members} members • ${x.t.status}</option>`).join("")}</select></label></div></div><div class="modalfoot"><button class="btn secondary close">Cancel</button><button class="btn primary" id="confirmDispatch">Dispatch</button></div>`);
 $$(".close").forEach(x=>x.onclick=closeModal);
 $("#confirmDispatch").onclick=()=>{let i=state.incidents.find(x=>x.id===$("#dispatchIncident").value),t=state.teams[Number($("#dispatchTeam").value)];i.status="ASSIGNED";i.assignedTeam=t.id;i.verified=i.verified||false;i.timeline=i.timeline||[];i.timeline.push({at:new Date().toISOString(),action:`Rescue team assigned: ${t.name}`,by:state.user.name});t.status="DEPLOYED";addAudit("ASSIGN_RESCUE",i.id,`${t.name} assigned`);state.notifications.unshift({title:"Rescue team dispatched",text:`${t.name} assigned to ${i.id}.`,time:"just now",userId:i.reporterId||null});save();closeModal();rescue();renderNotifications();toast(`${t.name} assigned to ${i.id}.`)};
}
function volunteers(){
 const vs=[{name:"Arun Volunteer",skills:["First Aid","Search & Rescue"],dist:"1.8 km",status:"AVAILABLE"},{name:"Priya Kumar",skills:["First Aid","Food Distribution"],dist:"3.2 km",status:"AVAILABLE"},{name:"Rahul S",skills:["Boat Handling","Search & Rescue"],dist:"6.1 km",status:"ON TASK"}];
 $("#volunteers").innerHTML=pageTop("Volunteers","Skill matching, availability and field safety information.",`<button class="btn primary" id="addVol">＋ Register / update</button>`)+
 `<div class="layout2"><div class="card"><div class="cardhead"><h3>Volunteer matching</h3><span>Skills + distance + availability</span></div><div class="body">${vs.map(v=>`<div class="row"><div><span class="avatar">${initials(v.name)}</span></div><div><h4>${v.name}</h4><p>${v.skills.join(" • ")} • ${v.dist}</p></div><span class="badge ${v.status==="AVAILABLE"?"low":"medium"}">${v.status}</span></div>`).join("")}</div></div><div class="card"><div class="cardhead"><h3>Volunteer safety</h3></div><div class="body"><ul class="info"><li>Accept only tasks within verified skills.</li><li>Use live location during field deployment.</li><li>Do not enter moving flood water without trained rescue support.</li><li>Keep communication and emergency equipment available.</li></ul></div></div></div>`;
 $("#addVol").onclick=()=>openModal(`<div class="modalhead"><h3>Volunteer profile</h3><button class="icon close">×</button></div><div class="modalbody"><div class="field"><label>Skills<input id="skills" value="${esc(state.user.skills?.join(", ")||"First Aid")}"></label></div><div class="field"><label>Availability<select id="avail"><option>Available</option><option>Unavailable</option></select></label></div></div><div class="modalfoot"><button class="btn secondary close">Cancel</button><button class="btn primary" id="saveVol">Save</button></div>`);$$(".close").forEach(x=>x.onclick=closeModal);$("#saveVol")?.addEventListener("click",()=>{state.user.skills=$("#skills").value.split(",").map(x=>x.trim()).filter(Boolean);SESSION.set(state.user);closeModal();toast("Volunteer profile updated.");volunteers()});
}
function shelters(){
 const isCitizen=state.user.role==="citizen";
 const assignedIncident=state.incidents.find(i=>i.reporterId===state.user.id&&i.assignedShelter!=null);
 const assignedIndex=assignedIncident?.assignedShelter??state.user.assignedShelter;
 $("#shelters").innerHTML=pageTop("Shelters",isCitizen?"View your assigned shelter and available safe facilities.":"Manage shelter capacity and allocate people to safe facilities.",`<button class="btn secondary" data-page="map">📍 Map</button>`);
 $("#shelters").innerHTML+=`<div class="layout3">${state.shelters.map((s,n)=>{let pct=Math.round(s.occupied/Math.max(1,s.capacity)*100),assigned=assignedIndex===n;return `<div class="card"><div class="body">${assigned?'<span class="badge low">ASSIGNED TO YOU</span>':""}<h3 style="font-size:14px;margin:10px 0 4px">${esc(s.name)}</h3><p style="font-size:9px;color:#718096">${esc(s.area)}</p><div style="display:flex;justify-content:space-between;font-size:9px"><b>${Math.max(0,s.capacity-s.occupied)} spaces available</b><span>${pct}% occupied</span></div><div class="statbar" style="margin-top:6px"><i style="width:${Math.min(100,pct)}%"></i></div><div class="feature" style="margin-top:10px">${s.water?"<span>💧 Water</span>":""}${s.food?"<span>🍱 Food</span>":""}${s.medical?"<span>⚕ Medical</span>":""}${s.accessible?"<span>♿ Accessible</span>":""}</div><button class="btn ${assigned?"primary":"secondary"}" style="margin-top:12px;width:100%" data-shelter="${n}">${isCitizen?(assigned?"View assigned shelter":"View shelter"):"Manage shelter"}</button></div></div>`}).join("")}</div>`;
 $$("[data-shelter]").forEach(b=>b.onclick=()=>{let idx=Number(b.dataset.shelter),s=state.shelters[idx];openModal(`<div class="modalhead"><h3>${esc(s.name)}</h3><button class="icon close">×</button></div><div class="modalbody"><div class="mini"><div><small>CAPACITY</small><b>${s.capacity}</b></div><div><small>OCCUPIED</small><b>${s.occupied}</b></div><div><small>AVAILABLE</small><b>${Math.max(0,s.capacity-s.occupied)}</b></div><div><small>AREA</small><b>${esc(s.area)}</b></div></div><div class="feature" style="margin-top:14px">${s.water?"<span>💧 Water</span>":""}${s.food?"<span>🍱 Food</span>":""}${s.medical?"<span>⚕ Medical</span>":""}${s.accessible?"<span>♿ Accessible</span>":""}</div></div><div class="modalfoot">${isCitizen?`<button class="btn primary" id="shelterMap">📍 View on map</button>`:`<button class="btn primary" id="allocateShelter">Allocate 1 person</button>`}<button class="btn secondary close">Close</button></div>`);
 $$(".close").forEach(x=>x.onclick=closeModal);
 $("#shelterMap")?.addEventListener("click",()=>{closeModal();go("map")});
 $("#allocateShelter")?.addEventListener("click",()=>{if(s.occupied>=s.capacity)return toast("Shelter is full.");s.occupied++;state.notifications.unshift({title:"Shelter allocation updated",text:`${s.name}: 1 person allocated. ${s.capacity-s.occupied} spaces remain.`,time:"just now"});save();closeModal();shelters();renderNotifications();toast("Shelter allocation updated.")});
 });
}
function resources(){
 $("#resources").innerHTML=pageTop("Resources","Authority inventory control and AI demand forecasts.",
 `<button class="btn secondary" id="allocateRes">⇄ Allocate to incident</button><button class="btn primary" id="updateRes">＋ Update stock</button>`);
 $("#resources").innerHTML+=`<div class="layout2">
 <div class="card"><div class="cardhead"><h3>Live inventory</h3><span>Editable authority inventory</span></div><div class="body">
 ${state.resources.map((r,idx)=>`<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;font-size:9px"><b>${esc(r.name)}</b><span>${r.available}/${r.required} ${esc(r.unit)}</span></div><div class="statbar" style="margin-top:6px"><i style="width:${Math.min(100,Math.round(r.available/Math.max(1,r.required)*100))}%"></i></div></div>`).join("")}
 </div></div>
 <div class="card"><div class="cardhead"><h3>AI demand forecast</h3><span>Next 6 hours</span></div><div class="body"><div class="mini"><div><small>WATER</small><b>+18%</b></div><div><small>FOOD</small><b>+15%</b></div><div><small>BLANKETS</small><b>+22%</b></div><div><small>FIRST AID</small><b>+9%</b></div></div><p style="font-size:9px;color:#718096;line-height:1.7;margin-top:14px">Forecasts support planning. Validate field stock before dispatch.</p></div></div></div>`;
 $("#updateRes").onclick=()=>openModal(`<div class="modalhead"><h3>Update resource stock</h3><button class="icon close">×</button></div>
 <div class="modalbody"><div class="field"><label>Resource<select id="resName">${state.resources.map((r,i)=>`<option value="${i}">${esc(r.name)}</option>`).join("")}</select></label></div>
 <div class="field"><label>Available quantity<input id="resQty" type="number" min="0" value="${state.resources[0]?.available||0}"></label></div>
 <div class="field"><label>Required quantity<input id="resReq" type="number" min="0" value="${state.resources[0]?.required||0}"></label></div></div>
 <div class="modalfoot"><button class="btn secondary close">Cancel</button><button class="btn primary" id="saveStock">Save changes</button></div>`);
 $$(".close").forEach(x=>x.onclick=closeModal);
 $("#resName")?.addEventListener("change",e=>{let r=state.resources[Number(e.target.value)];$("#resQty").value=r.available;$("#resReq").value=r.required});
 $("#saveStock")?.addEventListener("click",()=>{let i=Number($("#resName").value),r=state.resources[i];r.available=Math.max(0,Number($("#resQty").value||0));r.required=Math.max(0,Number($("#resReq").value||0));state.notifications.unshift({title:"Resource inventory updated",text:`${r.name}: ${r.available} ${r.unit} available.`,time:"just now"});save();closeModal();resources();renderNotifications();toast(`${r.name} stock updated.`)});
 $("#allocateRes").onclick=()=>{let active=state.incidents.filter(i=>i.status!=="RESOLVED");if(!active.length)return toast("No active incident available.");openModal(`<div class="modalhead"><h3>Allocate resources</h3><button class="icon close">×</button></div><div class="modalbody"><div class="field"><label>Incident<select id="arIncident">${active.map(i=>`<option value="${esc(i.id)}" ${i.id===state.pendingResourceIncident?"selected":""}>${esc(i.id)} • ${esc(i.type)} • ${esc(i.location)}</option>`).join("")}</select></label></div><div class="field"><label>Resource<select id="arResource">${state.resources.map((r,i)=>`<option value="${i}">${esc(r.name)} (${r.available} ${esc(r.unit)} available)</option>`).join("")}</select></label></div><div class="field"><label>Quantity<input id="arQty" type="number" min="1" value="1"></label></div></div><div class="modalfoot"><button class="btn secondary close">Cancel</button><button class="btn primary" id="confirmAllocation">Allocate</button></div>`);$$(".close").forEach(x=>x.onclick=closeModal);$("#confirmAllocation").onclick=()=>{let inc=state.incidents.find(i=>i.id===$("#arIncident").value),r=state.resources[Number($("#arResource").value)],q=Math.max(1,Number($("#arQty").value||1));if(q>r.available)return toast("Not enough stock available.");r.available-=q;inc.resourcesAllocated=inc.resourcesAllocated||[];inc.resourcesAllocated.push({resource:r.name,quantity:q,unit:r.unit,time:new Date().toISOString()});inc.timeline=inc.timeline||[];inc.timeline.push({at:new Date().toISOString(),action:`Resource allocated: ${q} ${r.unit} ${r.name}`,by:state.user.name});addAudit("ALLOCATE_RESOURCE",inc.id,`${q} ${r.unit} ${r.name}`);state.notifications.unshift({title:"Resources allocated",text:`${q} ${r.unit} of ${r.name} allocated to ${inc.id}.`,time:"just now",userId:inc.reporterId||null});state.pendingResourceIncident=null;save();closeModal();resources();renderNotifications();toast("Resources allocated successfully.")}};
}
let broadcastTicker=null;
const BROADCAST_CHANNEL=('BroadcastChannel' in window)?new BroadcastChannel('crisisbridge-emergency-alerts'):null;
let crisisSocket=null;
function connectCrisisSocket(){
 try{
  if(typeof io!=="function") return;
  crisisSocket=io(LAN_API_BASE||undefined,{transports:["websocket","polling"],reconnection:true});
  crisisSocket.on("emergency:broadcast", async payload=>{
    if(payload?.broadcast) await receiveBroadcast(payload.broadcast,payload.kind||"server");
  });
 }catch(e){console.info("Socket relay unavailable; local/offline mode continues.",e);}
}
connectCrisisSocket();
async function broadcastToCitizens(b,kind='alert'){
 const safe={...b}; delete safe._audioBlob;
 const payload={type:'CRISISBRIDGE_BROADCAST',kind,broadcast:safe,at:Date.now()};
 try{BROADCAST_CHANNEL?.postMessage(payload);}catch{}
 try{localStorage.setItem('cb_last_broadcast_event',JSON.stringify(payload));localStorage.removeItem('cb_last_broadcast_event');}catch{}
 // LAN delivery: the central lightweight server stores the recording and metadata,
 // allowing a citizen on another laptop on the same Wi-Fi/LAN to receive it.
 const remote=await publishBroadcastToLAN(b);
 if(remote?.broadcast){
   const merged={...b,...remote.broadcast};
   try{BROADCAST_CHANNEL?.postMessage({type:'CRISISBRIDGE_BROADCAST',kind,broadcast:merged,at:Date.now()});}catch{}
 }
}
async function receiveBroadcast(b,kind='alert'){
 if(!b||!state.user||state.user.role==='authority')return;
 const msg=translateEnglishTo(b.message,state.lang);
 state.receivedBroadcasts=state.receivedBroadcasts||[];
 const existing=state.receivedBroadcasts.findIndex(x=>x.id===b.id);
 const copy={...b,receivedAt:existing>=0?state.receivedBroadcasts[existing].receivedAt:new Date().toISOString(),translatedMessage:msg};
 if(existing>=0)state.receivedBroadcasts.splice(existing,1);
 state.receivedBroadcasts.unshift(copy);
 state.receivedBroadcasts=state.receivedBroadcasts.slice(0,50);
 state.notifications.unshift({title:`🚨 ${b.level} emergency`,text:`${b.area}: ${msg}`,time:'just now',broadcastId:b.id});
 state.notifications=state.notifications.slice(0,200);save();renderNotifications();
 if(state.page==='alerts')alerts();
 if(document.hidden===false && 'Notification' in window && Notification.permission==='granted') new Notification(`${b.level} Emergency`,{body:`${b.area}: ${msg}`});
 toast(`🚨 ${b.level} alert received: ${msg}`);
 // Best-effort automatic playback. Browsers may block autoplay; the citizen alert card always exposes Play Voice.
 if(b.audioUrl||b.audioKey){let src=b.audioUrl||null;if(!src&&b.audioKey){const blob=await AudioStore.get(b.audioKey);src=blob?URL.createObjectURL(blob):VoiceCache.get(b.audioKey);}if(src){const audio=new Audio(src);audio.onended=()=>{if(src.startsWith('blob:'))URL.revokeObjectURL(src)};audio.play().catch(()=>{});}}
}
function stopBroadcast(id,silent=false){
 const b=state.broadcasts.find(x=>x.id===id); if(!b)return;
 b.active=false; b.stoppedAt=new Date().toISOString(); save(); broadcastToCitizens(b,'stop');
 if(broadcastTicker && !state.broadcasts.some(x=>x.active)){clearInterval(broadcastTicker);broadcastTicker=null;}
 if(!silent){renderNotifications();toast(`Broadcast ${id} stopped.`);} if(state.page==='broadcast')broadcast();
}
function tickBroadcasts(){
 const now=Date.now(); let changed=false;
 state.broadcasts.forEach(b=>{
   // Scheduled recurring cycle: every 24/48 hours, each cycle lasts exactly 10 minutes.
   if(!b.active && b.cycleHours && b.nextCycleAt && now>=new Date(b.nextCycleAt).getTime()){
     b.active=true;b.startedAt=new Date(now).toISOString();b.endAt=new Date(now+600000).toISOString();b.nextAt=new Date(now+Number(b.repeatIntervalSec||60)*1000).toISOString();b.sentCount=1;b.cycleCount=(b.cycleCount||0)+1;b.lastSentAt=new Date(now).toISOString();
     state.notifications.unshift({title:`${b.level} scheduled emergency broadcast`,text:`${b.area}: ${b.message}`,time:'just now'});broadcastToCitizens(b,'start');changed=true;
   }
   if(!b.active)return;
   if(now>=new Date(b.endAt).getTime()){
     b.active=false;b.completedAt=new Date().toISOString();
     if(b.cycleHours){let next=new Date(b.nextCycleAt||now).getTime();const step=Number(b.cycleHours)*3600000;while(next<=now)next+=step;b.nextCycleAt=new Date(next).toISOString();}
     broadcastToCitizens(b,'complete');changed=true;return;
   }
   if(now>=new Date(b.nextAt).getTime()){
     const n=Math.max(1,Number(b.repeatIntervalSec||60));
     b.sentCount=(b.sentCount||1)+1;b.lastSentAt=new Date().toISOString();b.nextAt=new Date(now+n*1000).toISOString();
     state.notifications.unshift({title:`${b.level} emergency broadcast`,text:`REPEAT ${b.sentCount}: ${b.area}: ${b.message}`,time:'just now'});broadcastToCitizens(b,'repeat');changed=true;
   }
 });
 state.notifications=state.notifications.slice(0,200);
 if(changed){save();renderNotifications();if(state.page==='broadcast')broadcast();if(state.page==='alerts')alerts();}
 if(!state.broadcasts.some(x=>x.active) && broadcastTicker && !state.broadcasts.some(x=>x.cycleHours&&x.nextCycleAt)){clearInterval(broadcastTicker);broadcastTicker=null;}
}
function startBroadcastTicker(){if(!broadcastTicker && state.broadcasts.some(x=>x.active||x.cycleHours))broadcastTicker=setInterval(tickBroadcasts,1000);}
function broadcast(){
 const active=state.broadcasts.filter(x=>x.active); const scheduled=state.broadcasts.filter(x=>!x.active&&x.cycleHours&&x.nextCycleAt); const history=state.broadcasts.slice(0,10);
 const cards=active.length?active.map(b=>{const remaining=Math.max(0,Math.ceil((new Date(b.endAt).getTime()-Date.now())/1000));return `<div class="card" style="margin-top:14px;border-left:4px solid #e53e3e"><div class="cardhead"><h3>🔴 ACTIVE • ${esc(b.level)}</h3><span>${esc(b.id)}</span></div><div class="body"><p><b>${esc(b.area)}</b> — ${esc(b.message)}</p>${b.audioKey?`<div class="audio-status">🔊 <b>Authority voice attached</b> • Citizens can play this recording offline.</div>`:''}<div class="feature"><span>⏱️ 10-minute cycle: <b>${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}</b></span><span>🔁 Every ${b.repeatIntervalSec}s</span><span>📢 Sent ${b.sentCount||1} times</span></div><div class="actions" style="margin-top:10px"><button class="btn secondary" data-play-broadcast="${b.id}">🔊 Preview voice</button><button class="btn secondary" data-stop-broadcast="${b.id}">⏹ Stop broadcast</button></div></div></div>`}).join(''):'<div class="empty">No active emergency broadcasts.</div>';
 const sched=scheduled.map(b=>`<div class="row"><div><b>${esc(b.id)}</b><p>${esc(b.area)} — ${esc(b.message)}</p></div><small>Next 10-minute cycle: ${new Date(b.nextCycleAt).toLocaleString()}</small></div>`).join('');
 const hist=history.length?history.map(b=>`<div class="row"><div><b>${esc(b.id)} • ${esc(b.level)}</b><p>${esc(b.area)} — ${esc(b.message)}</p>${b.audioKey?'<small>🔊 Voice recording attached</small>':''}</div><small>${b.active?'ACTIVE':b.cycleHours?'SCHEDULED':'COMPLETED'} • ${b.sentCount||1} sends</small></div>`).join(''):'<div class="empty">No broadcast history.</div>';
 let recording=null;
 let audioKey=null;
 let audioBlob=null;
 const renderUI=()=>{
  $("#broadcast").innerHTML=pageTop("Emergency Broadcast","Authority-only offline alert centre. Record your own voice, attach it to the alert, repeat the alert for 10 minutes and optionally schedule another cycle after 24 or 48 hours.",`<button class="btn secondary" id="testAlert">Preview</button>`)+
  `<div class="layout2"><div class="card"><div class="cardhead"><h3>Create broadcast</h3><span>Offline voice + emergency alert</span></div><div class="body"><div class="field"><label>Alert level<select id="bLevel"><option>CRITICAL</option><option>HIGH</option><option>INFORMATION</option></select></label></div><div class="field"><label>Target area<input id="bArea" placeholder="Hosur / Bagalur Road / Government Hospital"></label></div><div class="field"><label>Message<textarea id="bMsg" placeholder="State the danger, affected area and recommended action."></textarea></label></div>
 <div class="voicebox"><div class="cardhead"><h3>🎙️ Authority Voice Recording</h3><span>Recorded locally • no cloud upload</span></div><div class="grid"><div class="field"><label>Voice language<select id="bVoiceLang">${VOICE_LANGS.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('')}</select></label></div><div class="field"><label>Voice text / translation<textarea id="bVoiceText" rows="2" placeholder="Optional: speak or type an emergency message"></textarea></label></div></div><div class="voiceactions"><button type="button" class="btn primary" id="bRecord">🔴 Record authority voice</button><button type="button" class="btn secondary" id="bStopRecord" disabled>⏹ Stop recording</button><button type="button" class="btn secondary" id="bVoiceMic">🎙️ Speech-to-text</button><button type="button" class="btn secondary" id="bVoiceTranslate">Translate to English</button></div><div id="bAudioBox" style="margin-top:10px"></div><small id="bVoiceStatus">The recording is stored in this device's offline database and delivered to open citizen tabs.</small></div>
 <div class="grid"><div class="field"><label>Repeat interval<select id="bInterval"><option value="30">Every 30 seconds</option><option value="60" selected>Every 1 minute</option><option value="120">Every 2 minutes</option></select></label></div><div class="field"><label>Repeat schedule<select id="bSchedule"><option value="0">Send now for 10 minutes only</option><option value="24">Send now + repeat after 24 hours</option><option value="48">Send now + repeat after 48 hours</option></select></label></div></div><div class="feature"><span>🔁 10-minute repeat cycle</span><span>🔊 Voice recording</span><span>💾 Offline delivery</span><span>📱 Citizen alert player</span></div><button class="btn primary" id="sendBroadcast" style="margin-top:12px">📢 Start emergency broadcast</button></div></div><div><div class="card"><div class="cardhead"><h3>Broadcast checklist</h3></div><div class="body"><ul class="info"><li>State the affected area and one clear action.</li><li>Record a short voice instruction for residents.</li><li>Voice recording remains local and works without internet.</li><li>Citizens receive the message and a Play Voice control.</li><li>Active alerts repeat during the 10-minute window.</li><li>Optional 24/48-hour recurrence starts another 10-minute cycle.</li></ul></div></div>${active.length?cards:''}</div></div>${scheduled.length?`<div class="card" style="margin-top:14px"><div class="cardhead"><h3>Scheduled cycles</h3></div><div class="body">${sched}</div></div>`:''}<div class="card" style="margin-top:14px"><div class="cardhead"><h3>Broadcast history</h3><span>Local audit trail</span></div><div class="body">${hist}</div></div>`;
  bindBroadcastUI();
 };
 async function previewVoice(){
  if(!audioKey)return toast('Record a voice message first.');
  let blob=await AudioStore.get(audioKey);
  if(blob){const u=URL.createObjectURL(blob),a=new Audio(u);a.onended=()=>URL.revokeObjectURL(u);try{await a.play();return}catch{}}
  const cached=VoiceCache.get(audioKey);
  if(cached){const a=new Audio(cached);try{await a.play();return}catch{}}
  toast('Voice recording is unavailable.');
 }
 async function bindBroadcastUI(){
  $("#sendBroadcast").onclick=async()=>{const area=$("#bArea").value.trim()||"selected area",msg=$("#bMsg").value.trim()||$("#bVoiceText").value.trim()||"Emergency alert issued.",interval=Number($("#bInterval").value),cycleHours=Number($("#bSchedule").value),now=Date.now();const b={id:"BC-"+Math.floor(1000+Math.random()*8999),level:$("#bLevel").value,area,message:msg,repeatIntervalSec:interval,durationSec:600,cycleHours,nextCycleAt:cycleHours?new Date(now+cycleHours*3600000).toISOString():null,startedAt:new Date(now).toISOString(),endAt:new Date(now+600000).toISOString(),nextAt:new Date(now+interval*1000).toISOString(),sentCount:1,active:true,cycleCount:1,audioKey:audioKey||null};state.broadcasts.unshift(b);state.notifications.unshift({title:`${b.level} emergency broadcast started`,text:`${area}: ${msg}${b.audioKey?' • voice attached':''}`,time:"just now"});save();await broadcastToCitizens(b,'start');startBroadcastTicker();renderNotifications();toast(b.audioKey?'Broadcast started with authority voice.':'Broadcast active for 10 minutes.');renderUI();};
  $$('[data-stop-broadcast]').forEach(x=>x.onclick=()=>stopBroadcast(x.dataset.stopBroadcast));
  $$('[data-play-broadcast]').forEach(x=>x.onclick=async()=>{const b=state.broadcasts.find(v=>v.id===x.dataset.playBroadcast);if(!b?.audioKey)return toast('No voice recording attached.');const blob=await AudioStore.get(b.audioKey);if(!blob)return toast('Voice recording not found on this device.');const u=URL.createObjectURL(blob),a=new Audio(u);a.onended=()=>URL.revokeObjectURL(u);a.play().catch(()=>toast('Press Preview voice again to play.'));});
  $("#testAlert").onclick=()=>toast("Preview: voice alert repeats for 10 minutes and can recur after 24 or 48 hours.");
  $("#bVoiceTranslate").onclick=()=>{const txt=$("#bVoiceText").value.trim();if(!txt)return toast('Enter or speak an emergency message.');const src=$("#bVoiceLang").value;$("#bMsg").value=translateBetween(txt,src,'en');$("#bVoiceStatus").textContent='English emergency message prepared from the selected language.'};
  const sr=window.SpeechRecognition||window.webkitSpeechRecognition;
  $("#bVoiceMic").onclick=async()=>{if(!sr){$("#bVoiceStatus").textContent='Browser speech recognition is unavailable. Use Record authority voice for fully offline audio, or type the message.';return toast('Speech-to-text is not supported by this browser.');}const selected=$("#bVoiceLang").value,speechLocale=SPEECH_LANG[selected]||'en-IN',localReady=await prepareLocalSpeech(sr,speechLocale),r=new sr();r.lang=speechLocale;r.interimResults=false;r.maxAlternatives=3;r.continuous=false;if('processLocally'in r)r.processLocally=localReady;r.onstart=()=>{$("#bVoiceMic").disabled=true;$("#bVoiceStatus").textContent=`Listening in ${$("#bVoiceLang option:checked").textContent}${localReady?' • offline model':''}…`};r.onresult=e=>{$("#bVoiceText").value=e.results?.[0]?.[0]?.transcript||'';$("#bMsg").value=translateEmergencyText($("#bVoiceText").value,$("#bVoiceLang").value);$("#bVoiceStatus").textContent='Speech recognized and translated to the broadcast message.'};r.onerror=e=>{$("#bVoiceStatus").textContent=e.error==='network'?'Browser speech-to-text needs an online service. Use Record authority voice for offline voice broadcast.':e.error==='not-allowed'?'Microphone permission was denied. Allow microphone access.':`Speech recognition error: ${e.error||'unknown'}.`};r.onend=()=>{$("#bVoiceMic").disabled=false};try{r.start()}catch{$("#bVoiceMic").disabled=false;toast('Microphone could not start.')}};
  $("#bRecord").onclick=async()=>{if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){return toast('Offline voice recording is not supported by this browser.');}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(x=>MediaRecorder.isTypeSupported?.(x))||'';recording={stream,rec:new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks:[]};recording.rec.ondataavailable=e=>{if(e.data?.size)recording.chunks.push(e.data)};recording.rec.onstop=async()=>{audioBlob=new Blob(recording.chunks,{type:recording.rec.mimeType||'audio/webm'});audioKey='voice-'+Date.now();await AudioStore.put(audioKey,audioBlob);await VoiceCache.put(audioKey,audioBlob);const url=URL.createObjectURL(audioBlob);$("#bAudioBox").innerHTML=`<div class="audio-recorded"><b>🔊 Authority voice ready</b><audio controls src="${url}" style="width:100%;margin-top:8px"></audio><button type="button" class="btn secondary" id="removeVoice" style="margin-top:8px">Remove recording</button></div>`;$("#removeVoice").onclick=()=>{VoiceCache.del(audioKey);AudioStore.del(audioKey);audioKey=null;audioBlob=null;$("#bAudioBox").innerHTML='';$("#bVoiceStatus").textContent='Voice recording removed.'};$("#bVoiceStatus").textContent='Voice saved locally. It will be attached to the citizen alert.';recording.stream.getTracks().forEach(t=>t.stop());recording=null;$("#bRecord").disabled=false;$("#bStopRecord").disabled=true};recording.rec.start();$("#bRecord").disabled=true;$("#bStopRecord").disabled=false;$("#bVoiceStatus").textContent='Recording authority voice locally… Speak clearly: location + danger + action.'}catch(e){toast('Microphone permission is required to record the authority voice.');}};
  $("#bStopRecord").onclick=()=>{if(recording?.rec?.state==='recording')recording.rec.stop()};
 }
 renderUI();
}
function alerts(){
 const active=(state.receivedBroadcasts||[]).filter(b=>b.active); const received=(state.receivedBroadcasts||[]).slice(0,20);
 const card=b=>`<div class="row" style="border-left:4px solid #e53e3e;padding-left:12px;display:block"><div style="display:flex;justify-content:space-between;gap:12px"><div><b>${esc(b.level)} • ${esc(b.area)}</b><p>${esc(b.translatedMessage||translateEnglishTo(b.message,state.lang))}</p></div><span class="badge critical">LIVE</span></div>${(b.audioKey||b.audioUrl)?`<div class="citizen-voice"><span>🔊 <b>Authority voice message</b></span><button class="btn primary" data-citizen-play="${esc(b.id)}">▶ Play voice</button></div>`:''}<small>Repeats during the 10-minute emergency window.</small></div>`;
 const activeHtml=active.map(card).join('')||'<div class="empty">No active emergency broadcasts.</div>';
 const historyHtml=received.map(b=>`<div class="row"><div><b>${esc(b.level)} • ${esc(b.area)}</b><p>${esc(b.translatedMessage||translateEnglishTo(b.message,state.lang))}</p>${(b.audioKey||b.audioUrl)?`<button class="btn secondary" data-citizen-play="${esc(b.id)}">🔊 Play recorded voice</button>`:''}</div><small>${b.active?'ACTIVE':'RECEIVED'} • ${esc(b.receivedAt?new Date(b.receivedAt).toLocaleString():'just now')}</small></div>`).join('')||'<div class="empty">No alerts received yet.</div>';
 $("#alerts").innerHTML=pageTop("Emergency Alerts","Citizen emergency alerts received locally from the authority. Text and recorded voice remain available without internet.")+`<div class="card"><div class="cardhead"><h3>🚨 Active emergency alerts</h3><span>${active.length} active</span></div><div class="body">${activeHtml}</div></div><div class="card" style="margin-top:14px"><div class="cardhead"><h3>Alert history</h3><span>Offline local feed</span></div><div class="body">${historyHtml}</div></div>`;
 $$('[data-citizen-play]').forEach(btn=>btn.onclick=async()=>{
  const b=state.receivedBroadcasts.find(v=>v.id===btn.dataset.citizenPlay);
  if(!b?.audioUrl&&!b?.audioKey)return toast('This alert has no recorded voice.');
  let u=b.audioUrl||null,objectUrl=false;
  if(!u&&b.audioKey){
    const blob=await AudioStore.get(b.audioKey);
    if(blob){u=URL.createObjectURL(blob);objectUrl=true;}
    else{u=VoiceCache.get(b.audioKey);}
  }
  if(!u)return toast('Voice recording is unavailable. Please use the Play Voice button again.');
  const a=new Audio(u);
  a.onended=()=>{if(objectUrl)URL.revokeObjectURL(u)};
  try{await a.play();}catch{toast('Press Play voice again after interacting with the page.')}
});
}
if(BROADCAST_CHANNEL)BROADCAST_CHANNEL.onmessage=e=>{if(e.data?.type==='CRISISBRIDGE_BROADCAST')receiveBroadcast(e.data.broadcast,e.data.kind)};
async function syncLocalBroadcastFeed(){
 if(!state.user || state.user.role==='authority')return;
 const incoming=S.get('cb_broadcasts',[]);
 if(!Array.isArray(incoming))return;
 state.broadcasts=incoming;
 // Recover broadcasts even when BroadcastChannel is unavailable or missed.
 // This is important for the offline LocalStorage demo and for a citizen tab opened after the authority sent the alert.
 const activeOrRecent=incoming.filter(b=>b && (b.active || (b.startedAt && Date.now()-new Date(b.startedAt).getTime()<15*60*1000)));
 for(const b of activeOrRecent){
   const already=(state.receivedBroadcasts||[]).some(x=>x.id===b.id);
   if(!already) await receiveBroadcast(b,'storage-sync');
 }
 if(state.page==='alerts')alerts();
}
if(BROADCAST_CHANNEL)BROADCAST_CHANNEL.onmessage=e=>{if(e.data?.type==='CRISISBRIDGE_BROADCAST')receiveBroadcast(e.data.broadcast,e.data.kind)};
window.addEventListener('storage',e=>{
 if(e.key==='cb_last_broadcast_event'&&e.newValue){try{const p=JSON.parse(e.newValue);if(p?.type==='CRISISBRIDGE_BROADCAST')receiveBroadcast(p.broadcast,p.kind)}catch{}}
 if(e.key==='cb_broadcasts' && state.user?.role!=='authority')syncLocalBroadcastFeed();
});
// Poll the shared LocalStorage feed as a final offline-safe delivery path.
setInterval(()=>{if(state.user?.role!=='authority'){syncLocalBroadcastFeed();fetchLANBroadcasts();}fetchLANIncidents();},2000);
setTimeout(()=>{if(state.user?.role!=='authority'){syncLocalBroadcastFeed();fetchLANBroadcasts();}fetchLANIncidents();},700);

function information(){
 $("#information").innerHTML=pageTop("Safety Information","Quick guidance for citizens and responders. Follow official instructions during real emergencies.")+
 `<div class="info-grid"><div class="card info"><h3>🌊 Flood</h3><ul><li>Move to higher ground when instructed.</li><li>Never drive or walk through moving flood water.</li><li>Save battery and carry water and essential medicines.</li><li>Share accurate GPS/location information.</li></ul></div><div class="card info"><h3>🔥 Fire</h3><ul><li>Leave through a safe exit.</li><li>Stay low in smoke.</li><li>Do not re-enter until authorities declare it safe.</li><li>Report trapped people and exact location.</li></ul></div><div class="card info"><h3>⚕ Medical</h3><ul><li>Call emergency services for life-threatening situations.</li><li>Share exact location and landmark.</li><li>Mention severe bleeding, breathing difficulty or unconsciousness.</li></ul></div><div class="card info"><h3>📱 Connectivity failure</h3><ul><li>Reduce battery use.</li><li>Use available peer-to-peer communication when implemented.</li><li>Try alternate communication channels.</li></ul></div><div class="card info"><h3>🎒 Emergency kit</h3><ul><li>Water and dry food.</li><li>Torch and power bank.</li><li>First aid and essential medicines.</li><li>ID and emergency contacts.</li></ul></div><div class="card info"><h3>🤖 AI safety</h3><ul><li>AI is decision support, not guaranteed truth.</li><li>Authorities verify critical reports.</li><li>Human responders make final life-safety decisions.</li></ul></div></div>`;
}
function analytics(){
 let total=state.incidents.length,ver=state.incidents.filter(i=>i.verified).length,res=state.incidents.filter(i=>i.status==="RESOLVED").length;
 $("#analytics").innerHTML=pageTop("Analytics","Operational metrics from the current CrisisBridge prototype dataset.")+
 `<div class="kpis">${kpi("TOTAL INCIDENTS",total,"All reports")}${kpi("VERIFIED",ver,total?Math.round(ver/total*100)+"% rate":"0%")}${kpi("RESOLVED",res,total?Math.round(res/total*100)+"% closure":"0%")}${kpi("AVG AI SCORE",Math.round(state.incidents.reduce((a,i)=>a+score(i),0)/Math.max(1,total))+"%","Decision support")}</div><div class="layout2"><div class="card"><div class="cardhead"><h3>Severity distribution</h3></div><div class="body">${["critical","high","medium","low"].map(s=>{let n=state.incidents.filter(i=>i.severity===s).length;return `<div style="margin-bottom:13px"><div style="display:flex;justify-content:space-between;font-size:9px"><b>${s}</b><span>${n}</span></div><div class="statbar" style="margin-top:6px"><i style="width:${total?Math.round(n/total*100):0}%"></i></div></div>`}).join("")}</div></div><div class="card"><div class="cardhead"><h3>System readiness</h3></div><div class="body"><div class="settings"><div class="setting"><div><b>GPS</b><small>Browser Geolocation API</small></div>${badge("low").replace("LOW","WORKING")}</div><div class="setting"><div><b>Voice assistant</b><small>Web Speech API</small></div>${badge("low").replace("LOW","WORKING*")}</div><div class="setting"><div><b>Offline storage</b><small>LocalStorage + PWA shell</small></div>${badge("low").replace("LOW","WORKING")}</div><div class="setting"><div><b>LAN relay</b><small>Optional server required for cross-device sync</small></div>${badge("medium").replace("MEDIUM","OPTIONAL")}</div></div></div></div></div>`;
}
// Offline backup: export operational records and voice-cache data without exporting account credentials.
const OFFLINE_BACKUP_KEYS=new Set(['cb_incidents','cb_notifications','cb_lang','cb_shelters','cb_teams','cb_resources','cb_broadcasts','cb_receivedBroadcasts','cb_auditLogs','cb_weatherCache','cb_gps']);
function exportOfflineBackup(){
 try{
  const data={format:'CrisisBridgeOfflineBackup',version:1,createdAt:new Date().toISOString(),storage:{}};
  for(let n=0;n<localStorage.length;n++){
   const key=localStorage.key(n);if(!key)continue;
   if(OFFLINE_BACKUP_KEYS.has(key)||key.startsWith('cb_voice_')){const value=localStorage.getItem(key);if(value!==null)data.storage[key]=value;}
  }
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`crisisbridge-offline-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast('Offline backup downloaded. Keep it somewhere safe.');
 }catch(e){toast('Backup failed. Check available device storage.');console.error('Offline backup export failed',e)}
}
function importOfflineBackup(file){
 if(!file)return;const reader=new FileReader();
 reader.onerror=()=>toast('Could not read the selected backup file.');
 reader.onload=()=>{
  try{
   const data=JSON.parse(String(reader.result||''));if(data.format!=='CrisisBridgeOfflineBackup'||!data.storage||typeof data.storage!=='object')throw new Error('Not a CrisisBridge backup');
   const allowed=k=>OFFLINE_BACKUP_KEYS.has(k)||k.startsWith('cb_voice_');let count=0;
   for(const [key,value] of Object.entries(data.storage)){if(!allowed(key)||typeof value!=='string')continue;localStorage.setItem(key,value);count++;}
   toast(`Imported ${count} offline data items. Reloading…`);setTimeout(()=>location.reload(),700);
  }catch(e){toast('Backup is invalid or too large for this browser. Existing data was not intentionally cleared.');console.error('Offline backup import failed',e)}
 };
 reader.readAsText(file);
}

function profile(){
 const u=state.user;
 $("#profile").innerHTML=pageTop("My Profile","Account information, role, language, location and notification preferences.",`<button class="btn primary" id="editProfile">Edit profile</button>`)+
 `<div class="profile"><div class="card profile-main"><div class="bigavatar">${initials(u.name)}</div><h2>${esc(u.name)}</h2><p>${esc(u.email)}</p><span class="badge medium">${roleLabel(u.role)}</span><p>📍 ${esc(u.area)}</p></div><div class="card"><div class="cardhead"><h3>Settings</h3></div><div class="body"><div class="settings"><div class="setting"><div><b>Language</b><small>Interface language</small></div><select id="profileLang"><option value="en">English</option><option value="ta">Tamil</option><option value="te">Telugu</option><option value="hi">Hindi</option><option value="kn">Kannada</option><option value="ml">Malayalam</option><option value="bn">Bengali</option><option value="mr">Marathi</option><option value="gu">Gujarati</option><option value="pa">Punjabi</option><option value="ur">Urdu</option><option value="or">Odia</option></select></div><div class="setting"><div><b>GPS / location sharing</b><small>Capture location for emergency reports</small></div><button id="locSwitch" class="switch on"><i></i></button></div><div class="setting"><div><b>Browser notifications</b><small>Incident and broadcast alerts</small></div><button class="btn secondary" id="enableNotify">Enable</button></div><div class="setting"><div><b>Offline mode</b><small>Local emergency data remains available</small></div>${badge("low").replace("LOW","ACTIVE")}</div></div></div></div></div>
 <div class="card" style="margin-top:14px"><div class="cardhead"><h3>Offline data backup</h3><span>Works without internet</span></div><div class="body"><p style="font-size:10px;line-height:1.7;color:#718096">Export operational records and cached voice notes to a file, or import a backup on another device. This is manual transfer, not live device-to-device synchronization. Backup files may contain sensitive emergency locations and recordings; store them securely. Account credentials are not included.</p><div class="actions"><button class="btn primary" id="exportOfflineBackup">⬇ Export offline backup</button><button class="btn secondary" id="chooseOfflineBackup">⬆ Import backup</button><input type="file" id="offlineBackupFile" accept="application/json,.json" hidden></div></div></div>`;
 $("#profileLang").value=state.lang;$("#profileLang").onchange=e=>{state.lang=e.target.value;save();shell();go("profile")};$("#enableNotify").onclick=notify;$("#editProfile").onclick=editProfile;$("#locSwitch").onclick=e=>e.currentTarget.classList.toggle("on");
 $("#exportOfflineBackup").onclick=exportOfflineBackup;$("#chooseOfflineBackup").onclick=()=>$("#offlineBackupFile").click();$("#offlineBackupFile").onchange=e=>importOfflineBackup(e.target.files?.[0]);
}
function editProfile(){
 const u=state.user;openModal(`<div class="modalhead"><h3>Edit profile</h3><button class="icon close">×</button></div><div class="modalbody"><div class="grid"><div class="field"><label>Full name<input id="epName" value="${esc(u.name)}"></label></div><div class="field"><label>Phone<input id="epPhone" value="${esc(u.phone||"")}"></label></div></div><div class="field"><label>Area<input id="epArea" value="${esc(u.area||"")}"></label></div></div><div class="modalfoot"><button class="btn secondary close">Cancel</button><button class="btn primary" id="saveProfile">Save changes</button></div>`);$$(".close").forEach(x=>x.onclick=closeModal);$("#saveProfile").onclick=()=>{u.name=$("#epName").value||u.name;u.phone=$("#epPhone").value;u.area=$("#epArea").value||u.area;state.user=u;SESSION.set(u);closeModal();shell();go("profile");toast("Profile updated.")};
}
function architecture(){
 $("#architecture").innerHTML=pageTop("System Architecture","CrisisBridge implementation mapped to the original project architecture.")+
 `<div class="card"><div class="body"><img src="assets/system-architecture.png" alt="CrisisBridge system architecture" style="max-width:100%;border:1px solid #e4e9f0;border-radius:11px"></div></div><div class="layout2" style="margin-top:14px"><div class="card"><div class="cardhead"><h3>Data flow</h3></div><div class="body"><pre style="margin:0;background:#081220;color:#c9d8eb;padding:15px;border-radius:10px;font-size:9px;line-height:1.7;overflow:auto">Citizen / Volunteer / Authority
        ↓
GPS + Voice + Emergency Report
        ↓
Offline storage + Synchronization
        ↓
Node.js + Express API
        ↓
MongoDB
        ↓
Command Centre + OpenStreetMap
        ↓
AI decision support
        ↓
Rescue / Volunteers / Shelters / Resources</pre></div></div><div class="card"><div class="cardhead"><h3>Production integrations</h3></div><div class="body"><ul class="info"><li>Android Kotlin + Room for offline citizen app.</li><li>Google Nearby Connections for peer-to-peer alerts.</li><li>MongoDB for persistent operational data.</li><li>Socket.IO for real-time dashboard updates.</li><li>JWT/session authentication with secure password hashing.</li><li>AI service for prioritization, matching and forecasting.</li></ul></div></div></div>`;
}
function openModal(content){$("#modal").innerHTML=`<div class="modalbg"><div class="modalbox">${content}</div></div>`}
function closeModal(){$("#modal").innerHTML=""}
function bind(){ $$("[data-page]").forEach(b=>b.onclick=()=>go(b.dataset.page)) }
async function notify(){if(!("Notification"in window))return toast("Notifications are not supported.");let p=await Notification.requestPermission();toast(p==="granted"?"Notifications enabled.":"Notification permission not granted.")}
function renderNotifications(){$("#notifDot").style.display=state.notifications.length?"block":"none"}
function showNotifications(){const relevant=state.user.role==="authority"?state.notifications:state.notifications.filter(n=>!n.userId||n.userId===state.user.id);openModal(`<div class="modalhead"><h3>Notifications</h3><button class="icon close">×</button></div><div class="modalbody">${relevant.slice(0,12).map(n=>`<div style="padding:10px 0;border-bottom:1px solid #edf0f4"><b style="font-size:10px">${esc(n.title)}</b><p style="font-size:9px;color:#718096;margin:4px 0">${esc(n.text)}</p><small style="font-size:8px;color:#9aa3b2">${esc(n.time)}</small></div>`).join("")||'<div class="empty">No notifications.</div>'}</div><div class="modalfoot"><button class="btn secondary close">Close</button><button class="btn secondary" id="clearN">Clear all</button></div>`);$$('.close').forEach(x=>x.onclick=closeModal);$("#clearN").onclick=()=>{if(state.user.role==="authority")state.notifications=[];else state.notifications=state.notifications.filter(n=>n.userId&&n.userId!==state.user.id);save();closeModal();renderNotifications();toast("Notifications cleared.")}}
function auth(){
 let users=S.get("cb_users",USERS);if(!users.length){S.set("cb_users",USERS);users=USERS}
 $$(".tabs button").forEach(b=>b.onclick=()=>authMode(b.dataset.auth));
 $("#loginForm").onsubmit=e=>{e.preventDefault();let id=$("#loginId").value.trim().toLowerCase(),pass=$("#loginPass").value,u=users.find(x=>(x.email.toLowerCase()===id||x.phone===id)&&x.password===pass);if(!u)return toast("Invalid credentials. Use a demo account.");state.user=u;SESSION.set(u);enter()};
 $("#registerForm").onsubmit=e=>{e.preventDefault();if(users.some(x=>x.email.toLowerCase()===$("#rEmail").value.trim().toLowerCase()))return toast("Email already registered.");let u={id:"U"+Date.now(),name:$("#rName").value.trim(),phone:$("#rPhone").value.trim(),email:$("#rEmail").value.trim().toLowerCase(),password:$("#rPass").value,role:$("#rRole").value,area:$("#rArea").value.trim(),skills:$("#rRole").value==="volunteer"?["First Aid"]:[]};users.push(u);S.set("cb_users",users);state.user=u;SESSION.set(u);enter()};
 $("#showPass").onclick=()=>{let x=$("#loginPass");x.type=x.type==="password"?"text":"password"};$("#forgot").onclick=()=>toast("Demo password reset: production backend would send a secure reset link.");
 $("#authLang").onchange=e=>{state.lang=e.target.value;save();toast("Language preference saved.")};
}
function authMode(m){$$(".tabs button").forEach(x=>x.classList.toggle("active",x.dataset.auth===m));$("#loginForm").classList.toggle("hidden",m!=="login");$("#registerForm").classList.toggle("hidden",m!=="register");$("#authHeading").textContent=m==="login"?"Welcome back":"Create your account";$("#authSub").textContent=m==="login"?"Sign in to continue.":"Join the emergency response network."}
function enter(){$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");shell();go("dashboard");toast(`Welcome, ${state.user.name.split(" ")[0]}!`)}
function logout(){
  SESSION.set(null);
  state.user=null;
  state.page="dashboard";
  closeModal();
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  $("#loginForm").reset();
  authMode("login");
  $("#loginId")?.focus();
  if(history.replaceState) history.replaceState(null,"",location.href.split("#")[0]);
  toast("Logged out successfully.");
}
function onlineState(){let on=navigator.onLine;$("#connDot").classList.toggle("off",!on);$("#connTitle").textContent=on?"Online":"Offline mode";$("#connSub").textContent=on?"Data synchronized":"Reports stored locally"}
function boot(){
 if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(()=>{});
 auth();$("#logout").onclick=logout;$("#notifications").onclick=showNotifications;$("#gpsTop").onclick=()=>gps(true);$("#userMini").onclick=()=>go("profile");$("#openSide").onclick=()=>$("#sidebar").classList.add("open");$("#closeSide").onclick=()=>$("#sidebar").classList.remove("open");$("#language").onchange=e=>{state.lang=e.target.value;save();shell();go(state.page)};
 window.addEventListener("online",()=>{onlineState();toast("Connection restored.")});window.addEventListener("offline",()=>{onlineState();toast("Offline mode active. Reports stay on this device.")});window.addEventListener("storage",e=>{if(e.key&&e.key.startsWith("cb_")&&state.user&&state.page==="profile")profile()});onlineState();startBroadcastTicker();tickBroadcasts();
 if(state.user)enter();else{$("#auth").classList.remove("hidden");$("#app").classList.add("hidden");authMode("login")}
}

/* ===================== ADVANCED OFFLINE MODULES ===================== */
function smart(){
 const critical=state.incidents.filter(i=>score(i)>=80&&i.status!=="RESOLVED");
 const duplicates=[];
 for(let a=0;a<state.incidents.length;a++)for(let b=a+1;b<state.incidents.length;b++){const x=state.incidents[a],y=state.incidents[b];if(x.lat&&y.lat&&Math.abs(x.lat-y.lat)<.01&&Math.abs(x.lng-y.lng)<.01&&x.type===y.type)duplicates.push([x,y])}
 const totalPeople=state.incidents.reduce((n,i)=>n+(i.people||0),0),weather=state.weatherCache;
 const rows=state.incidents.filter(i=>i.status!=="RESOLVED").sort((a,b)=>score(b)-score(a)).slice(0,6).map(i=>{const team=recommendTeam(i),vol=recommendVolunteer(i),sh=recommendShelter(i);return '<div class="row"><div><b class="id">'+esc(i.id)+'</b><br>'+badge(i.severity)+'</div><div style="flex:1"><h4>'+esc(i.type)+' • '+esc(i.location)+'</h4><p>Priority '+score(i)+'% • '+(i.people||0)+' people • '+(i.medical?'medical • ':'')+(i.vulnerability&&i.vulnerability!=="none"?esc(i.vulnerability)+' • ':'')+'Skill: '+esc(i.requiredSkill||"Search & Rescue")+'</p><small>🚑 '+esc(team?.name||"No team match")+' • 🦺 '+esc(vol?.name||"No volunteer match")+' • 🏠 '+esc(sh?.name||"No shelter match")+'</small></div><strong class="priority">'+score(i)+'%</strong></div>'}).join('')||'<div class="empty">No active incidents.</div>';
 const dupRows=duplicates.slice(0,4).map(d=>'<div class="feature" style="margin-top:8px"><span>⚠️ '+esc(d[0].id)+' ↔ '+esc(d[1].id)+'</span><small>'+esc(d[0].type)+' near same location</small></div>').join('')||'<div class="empty">No likely duplicates detected.</div>';
 const auditRows=(state.auditLogs||[]).slice(0,12).map(a=>'<div class="row"><div><b>'+esc(a.action)+'</b><p>'+esc(a.details)+'</p></div><small>'+esc(a.by)+'<br>'+new Date(a.at).toLocaleString()+'</small></div>').join('')||'<div class="empty">No audit events yet.</div>';
 const weatherHtml=weather?'<div class="mini"><div><small>TEMP</small><b>'+weather.temp+'°C</b></div><div><small>RAIN</small><b>'+weather.rain+' mm</b></div><div><small>WIND</small><b>'+weather.wind+' km/h</b></div><div><small>RISK</small><b>'+esc(weather.risk)+'</b></div></div><p style="font-size:9px;color:#718096;margin-top:12px">Cached '+new Date(weather.at).toLocaleString()+' • usable without internet.</p>':'<div class="empty">No weather snapshot cached. Cache one while online; the last snapshot remains available offline.</div>';
 const offline=badge("low").replace("LOW","ACTIVE");
 $("#smart").innerHTML=pageTop("Smart Operations","Offline-first intelligence for prioritization, matching, duplicate detection, shelter/resource recommendations and audit history.",'<button class="btn secondary" id="cacheWeather">🌦️ Cache weather</button><button class="btn primary" id="runSmart">✦ Run analysis</button>')+
 '<div class="kpis">'+kpi("CRITICAL QUEUE",critical.length,"Priority ≥ 80")+kpi("PEOPLE AFFECTED",totalPeople,"Current incident set")+kpi("DUPLICATE FLAGS",duplicates.length,"Location + type")+kpi("AUDIT EVENTS",(state.auditLogs||[]).length,"Local history")+'</div>'+
 '<div class="layout2" style="margin-top:14px"><div class="card"><div class="cardhead"><h3>Priority & rescue recommendations</h3><span>Works offline</span></div><div class="body">'+rows+'</div></div>'+
 '<div class="card"><div class="cardhead"><h3>Offline weather cache</h3><span>Last saved snapshot</span></div><div class="body">'+weatherHtml+'<hr><h4>Duplicate detection</h4>'+dupRows+'</div></div></div>'+
 '<div class="layout2" style="margin-top:14px"><div class="card"><div class="cardhead"><h3>Audit log</h3><span>Local accountability history</span></div><div class="body">'+auditRows+'</div></div><div class="card"><div class="cardhead"><h3>Offline capabilities</h3></div><div class="body"><div class="settings"><div class="setting"><div><b>Incident storage</b><small>LocalStorage</small></div>'+offline+'</div><div class="setting"><div><b>AI priority</b><small>Local deterministic rules</small></div>'+offline+'</div><div class="setting"><div><b>Recommendations</b><small>Teams, volunteers, shelters</small></div>'+offline+'</div><div class="setting"><div><b>Weather</b><small>Last cached snapshot</small></div>'+badge(weather?"low":"medium").replace(weather?"LOW":"MEDIUM",weather?"CACHED":"NOT CACHED")+'</div></div></div></div></div>';
 $("#cacheWeather").onclick=cacheWeather;$("#runSmart").onclick=()=>{smart();toast("Offline intelligence analysis completed.")};
}
function recommendTeam(i){let skill=(i.requiredSkill||"").toLowerCase();return [...state.teams].filter(t=>t.status!=="DEPLOYED").sort((a,b)=>teamFit(b,i,skill)-teamFit(a,i,skill))[0]||null}
function teamFit(t,i,skill){let n=t.status==="AVAILABLE"?50:25;if(skill&&((t.vehicle||"").toLowerCase().includes("boat")&&skill.includes("water")))n+=35;if(i.type.toLowerCase().includes("medical")&&(t.name||"").toLowerCase().includes("medical"))n+=35;n+=Math.max(0,20-(t.members||0));return n}
function recommendVolunteer(i){let req=(i.requiredSkill||"").toLowerCase();let list=state.user.role==="volunteer"?[state.user]:S.get("cb_volunteers",[]);if(!list.length)list=[{name:"Arun Volunteer",skills:["First Aid","Search & Rescue"],availability:"Available",area:"Hosur"}];return list.filter(v=>(v.availability||"Available").toLowerCase().includes("available")).sort((a,b)=>((b.skills||[]).join(" ").toLowerCase().includes(req)?1:0)-((a.skills||[]).join(" ").toLowerCase().includes(req)?1:0))[0]||null}
function recommendShelter(i){return [...state.shelters].filter(s=>s.capacity>s.occupied).sort((a,b)=>shelterFit(b,i)-shelterFit(a,i))[0]||null}
function shelterFit(s,i){let n=(s.capacity-s.occupied)>=(i.people||1)?50:10;if(i.medical&&s.medical)n+=25;if(s.accessible&&["elderly","disability","pregnant"].includes(i.vulnerability))n+=15;if(s.water)n+=5;if(s.food)n+=5;return n}
function cacheWeather(){let rain=Math.round(Math.random()*80),temp=Math.round(24+Math.random()*10),wind=Math.round(8+Math.random()*35),risk=rain>55?"HIGH":rain>30?"MODERATE":"LOW";state.weatherCache={rain,temp,wind,risk,at:new Date().toISOString(),source:"Offline demo cache"};save();smart();toast("Weather snapshot cached locally.")}
boot();
startBroadcastTicker();
