// ParceLLA — Frontend
// Use relative URL when served from Railway, absolute when on Vercel
const API = window.location.hostname === 'parcella-api-production.up.railway.app'
  ? ''  // same server — use relative paths
  : 'https://parcella-api-production.up.railway.app';
const GMAPS_KEY = 'AIzaSyAC7R0Wlh41L71vexWCYqdn3WAjx8PJeQ0';

// LA City Open Data — fetched client-side (browser not blocked like Railway)
const SOCRATA_TOKEN = 'Mj7n61b8beE9ZbxZPhNMSUrh';
const SOCRATA_BASE  = 'https://data.lacity.org/resource';

async function fetchLACityData(datasetId, params = {}) {
  const qs = new URLSearchParams({ $limit: 200, ...params });
  const url = `${SOCRATA_BASE}/${datasetId}.json?${qs}`;
  const res = await fetch(url, {
    headers: { 'X-App-Token': SOCRATA_TOKEN, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`LA City data: HTTP ${res.status}`);
  return res.json();
}

// Fetch new housing unit permits from LA City
async function fetchHousingPermits() {
  try {
    const data = await fetchLACityData('cpkv-aajs', { $order: 'date DESC' });
    console.log('[ladbs] Fetched', data.length, 'housing permits from LA City');
    return data;
  } catch (e) {
    console.warn('[ladbs] Could not fetch housing permits:', e.message);
    return [];
  }
}

function fullAddress(addr) {
  return `${addr}, Los Angeles, CA`;
}

function addressQuery(addr) {
  return encodeURIComponent(fullAddress(addr));
}

// Street View thumbnail for any address
function streetViewURL(addr, w=640, h=220) {
  return `https://maps.googleapis.com/maps/api/streetview?size=${w}x${h}&location=${addressQuery(addr)}&fov=90&heading=0&pitch=5&key=${GMAPS_KEY}`;
}

function staticMapURL(addr, maptype='roadmap', w=640, h=220) {
  const q = addressQuery(addr);
  return `https://maps.googleapis.com/maps/api/staticmap?size=${w}x${h}&scale=2&zoom=17&maptype=${maptype}&center=${q}&markers=color:0x0f1f3d%7C${q}&key=${GMAPS_KEY}`;
}

// Neighborhood center coordinates for Street View
const HOOD_COORDS = {
  'Silver Lake':   { lat: 34.0839, lng: -118.2703 },
  'Echo Park':     { lat: 34.0784, lng: -118.2607 },
  'Highland Park': { lat: 34.1084, lng: -118.2042 },
  'Los Feliz':     { lat: 34.1019, lng: -118.2923 },
  'Koreatown':     { lat: 34.0586, lng: -118.3006 },
  'Mid-Wilshire':  { lat: 34.0626, lng: -118.3404 },
  'Culver City':   { lat: 34.0211, lng: -118.3965 },
  'Mar Vista':     { lat: 34.0005, lng: -118.4266 },
  'West Adams':    { lat: 34.0139, lng: -118.3338 },
  'Boyle Heights': { lat: 34.0333, lng: -118.2126 },
};

// Google Maps search link for an address
function mapsLink(addr) {
  return `https://www.google.com/maps/search/?api=1&query=${addressQuery(addr)}`;
}

function directionsLink(addr) {
  return `https://www.google.com/maps/dir/?api=1&destination=${addressQuery(addr)}`;
}

function streetViewLink(addr) {
  return `https://www.google.com/maps/search/?api=1&query=${addressQuery(addr)}&layer=c`;
}

function officialResearchLink(addr, source) {
  return `https://www.google.com/search?q=${encodeURIComponent(fullAddress(addr) + ' ' + source)}`;
}

function nearbySearchLink(addr, query) {
  return `https://www.google.com/maps/search/${encodeURIComponent(query + ' near ' + fullAddress(addr))}`;
}

function mapPreviewForMode(s, mode) {
  if (mode === 'satellite') return staticMapURL(s.addr, 'satellite');
  if (mode === 'terrain') return staticMapURL(s.addr, 'terrain');
  if (mode === 'street') return streetViewURL(s.addr);
  return staticMapURL(s.addr, 'roadmap');
}

function mapOpenLinkForMode(s, mode) {
  if (mode === 'street') return streetViewLink(s.addr);
  return mapsLink(s.addr);
}

function mapModeLabel(mode) {
  return { roadmap:'Map', satellite:'Satellite', terrain:'Terrain', street:'Street View' }[mode] || 'Map';
}

function setMapMode(id, mode) {
  const s = allSites.find(x => x.id === id);
  if (!s) return;
  const img = g('map-img-' + id);
  const link = g('map-link-' + id);
  const label = g('map-label-' + id);
  if (img) img.src = mapPreviewForMode(s, mode);
  if (link) link.href = mapOpenLinkForMode(s, mode);
  if (label) label.textContent = mapModeLabel(mode) + ' - ' + s.addr;
  document.querySelectorAll('#map-tabs-' + id + ' .mapbtn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.mode === mode);
  });
}

function renderMapPanel(s) {
  const modes = ['roadmap', 'satellite', 'terrain', 'street'];
  const links = [
    ['Google Maps', mapsLink(s.addr)],
    ['Directions', directionsLink(s.addr)],
    ['ZIMAS zoning', officialResearchLink(s.addr, 'ZIMAS zoning')],
    ['LADBS permits', officialResearchLink(s.addr, 'LADBS permits PCIS')],
    ['Rent comps nearby', nearbySearchLink(s.addr, 'apartments for rent')],
    ['Sales comps nearby', nearbySearchLink(s.addr, 'multifamily sale comps')],
  ];
  return `
    <div class="maptabs" id="map-tabs-${s.id}">
      ${modes.map((mode, i) => `<button class="mapbtn${i===0?' on':''}" data-mode="${mode}" onclick="setMapMode(${s.id}, '${mode}')">${mapModeLabel(mode)}</button>`).join('')}
    </div>
    <a id="map-link-${s.id}" href="${mapsLink(s.addr)}" target="_blank" rel="noopener" class="mapcard">
      <img id="map-img-${s.id}" src="${staticMapURL(s.addr, 'roadmap')}" alt="Map of ${s.addr}" onerror="this.parentElement.innerHTML='<div style=\\'height:82px;display:flex;align-items:center;justify-content:center;background:#f8f8f8;font-size:11px;color:#aaa\\'>Map preview unavailable</div>'">
      <div id="map-label-${s.id}" class="mapcap">Map - ${s.addr}</div>
    </a>
    <div class="maplinks">
      ${links.map(([label, href]) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`).join('')}
    </div>`;
}
const fmtM = n => n >= 1e6 ? '$'+(Math.round(n/1e5)/10)+'M' : n >= 1e3 ? '$'+Math.round(n/1e3)+'K' : '$'+Math.round(n||0);
const fmtD = n => '$'+Math.round(n||0).toLocaleString();
const irrC = v => v >= 18 ? '#1d9e75' : v >= 12 ? '#ef9f27' : '#e24b4a';
const irrL = v => v >= 18 ? 'Strong' : v >= 12 ? 'Moderate' : 'Weak';
let allSites = [], filtered = [], openId = null, activeView = 'list', watchlist = loadWatchlist(), userMetrics = null;
const g = id => document.getElementById(id);
const LA_MAP_BOUNDS = { minLat: 33.92, maxLat: 34.18, minLng: -118.48, maxLng: -118.16 };
const MAP_TRANSIT_NODES = [
  { name:'Union Station', lat:34.0560, lng:-118.2365 },
  { name:'7th/Metro', lat:34.0483, lng:-118.2589 },
  { name:'Wilshire/Vermont', lat:34.0625, lng:-118.2922 },
  { name:'Expo/Western', lat:34.0271, lng:-118.3089 },
  { name:'Culver City', lat:34.0109, lng:-118.3896 },
  { name:'Hollywood/Highland', lat:34.1019, lng:-118.3397 },
];
const mapLayers = { forSale:true, rti:true, offMarket:true, watchlist:true, transit:true };
const FRONTEND_HARD_COST_PSF = {'Multifamily':285,'Mixed-Use':320,'Condo/TH':340,'New House':275};
const FRONTEND_CAP_RATES = {
  'Silver Lake':0.0475,'Echo Park':0.0500,'Highland Park':0.0525,'Los Feliz':0.0475,
  'Koreatown':0.0525,'Mid-Wilshire':0.0500,'Culver City':0.0475,'Mar Vista':0.0500,
  'West Adams':0.0525,'Boyle Heights':0.0575,'Hollywood':0.0500,'North Hollywood':0.0525,
  'Northridge':0.0550,'Van Nuys':0.0550,'Reseda':0.0575,'Panorama City':0.0600
};
const DEFAULT_USER_METRICS = {
  hardCostMultifamily:285,
  hardCostMixedUse:320,
  hardCostCondoTH:340,
  hardCostNewHouse:275,
  baseSoftCostPct:18,
  loanToCostPct:65,
  interestRatePct:6.5,
  vacancyPct:5,
  expenseRatioPct:35,
  rentGrowthPct:3,
  exitCapSpreadBps:25,
};
const CONSTRUCTION_PLANS = {
  auto:     { label:'Auto by type', hardCost:null, softPct:0.18, months:18, rentPremium:0,    note:'Uses the project-type base cost.' },
  value:    { label:'Value engineered', hardCost:255, softPct:0.16, months:16, rentPremium:-0.02, note:'Simpler spec, tighter soft costs, and a modest rent haircut.' },
  typev:    { label:'Type V wood frame', hardCost:285, softPct:0.18, months:18, rentPremium:0,    note:'Baseline 3-5 story wood-frame multifamily.' },
  modular:  { label:'Modular / prefab', hardCost:265, softPct:0.17, months:14, rentPremium:0,    note:'Lower field time with prefab/modular execution.' },
  podium:   { label:'Type III podium', hardCost:340, softPct:0.22, months:22, rentPremium:0.03, note:'Podium or mixed-use structure with more common-area load.' },
  luxury:   { label:'Luxury finish', hardCost:380, softPct:0.23, months:22, rentPremium:0.08, note:'Higher finishes, amenities, and achievable rent premium.' },
  concrete: { label:'Concrete / steel', hardCost:450, softPct:0.25, months:28, rentPremium:0.06, note:'Heavy structure/high-rise plan; use only when the site requires it.' },
};
userMetrics = loadUserMetrics();

document.getElementById('app').innerHTML = `<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--navy:#0f1f3d;--navy2:#172b52;--gold:#b98b2f;--green:#1d9e75;--red:#d94b4b;--amber:#ef9f27;--blue:#378add;--ink:#1b2533;--muted:#6f7b8c;--line:#dfe5ec;--panel:#ffffff;--soft:#f3f6f9;--soft2:#e9eef4}
body{font-family:'Inter',system-ui,sans-serif;background:#eef2f6;color:var(--ink);height:100vh;overflow:hidden}
.nav{background:linear-gradient(90deg,var(--navy),#172b52);padding:0 16px;height:48px;display:flex;align-items:center;gap:12px;position:fixed;top:0;left:0;right:0;z-index:100;box-shadow:0 1px 8px rgba(15,31,61,0.18)}
.logo{font-size:16px;font-weight:800;color:#fff;letter-spacing:0;flex-shrink:0}.logo span{color:var(--gold)}
.ntag{font-size:10px;color:rgba(255,255,255,0.62);letter-spacing:0;text-transform:uppercase}.nav-r{margin-left:auto;display:flex;align-items:center;gap:7px}.navbtn{border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.08);color:#fff;border-radius:6px;padding:5px 8px;font-size:10px;font-weight:800;cursor:pointer}.navbtn:hover{background:rgba(255,255,255,.15)}
.adot{width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 3px rgba(239,159,39,0.18)}.adot.ok{background:var(--green);box-shadow:0 0 0 3px rgba(29,158,117,0.18)}.albl{font-size:10px;color:rgba(255,255,255,0.7)}
.layout{display:flex;height:calc(100vh - 48px);margin-top:48px}
.sb{width:230px;background:#fbfcfd;border-right:1px solid var(--line);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}
.sb-body{overflow-y:auto;flex:1;padding:10px 12px}.sb h4{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0;color:#8a96a8;margin:11px 0 5px}.sb h4:first-child{margin-top:0}
.cb{display:flex;align-items:center;gap:6px;font-size:11px;color:#3f4a5a;margin-bottom:3px;cursor:pointer;line-height:1.25}.cb input{accent-color:var(--navy);width:12px;height:12px}
.sbs{width:100%;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-size:11px;margin-bottom:5px;background:#fff;color:var(--ink)}
.sb2{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px}.sb2 input{width:100%;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-size:11px;background:#fff;text-align:right;color:var(--ink)}
.sbf{padding:9px 12px;border-top:1px solid var(--line);background:#fff}.bp{width:100%;padding:8px;background:var(--navy);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-bottom:5px}.bp:hover{background:var(--navy2)}
.br{width:100%;padding:6px;background:#fff;color:#687485;border:1px solid var(--line);border-radius:6px;font-size:11px;cursor:pointer}.br:hover{border-color:#b8c2cf;color:var(--ink)}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}.mfb{display:grid;grid-template-columns:repeat(6,minmax(118px,1fr));gap:6px;padding:8px 10px;background:#f8fafc;border-bottom:1px solid var(--line);flex-shrink:0}
.mf{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 8px}.mf.active{border-color:var(--gold);box-shadow:inset 0 0 0 1px rgba(185,139,47,.25);background:#fffdf7}.mfl{font-size:8px;color:#778397;text-transform:uppercase;letter-spacing:0;margin-bottom:4px;font-weight:800}.mfr{display:flex;align-items:center;gap:4px}.mfr input{flex:1;font-size:11px;padding:3px 4px;border:1px solid var(--line);border-radius:5px;background:#fff;text-align:right;min-width:0}.mfr span{font-size:9px;color:#8994a5;flex-shrink:0}.mfa{padding:4px 6px;border:1px solid var(--navy);background:var(--navy);color:#fff;border-radius:5px;font-size:9px;font-weight:800;cursor:pointer;white-space:nowrap}.mfa.clear{border-color:var(--line);background:#fff;color:#687485}.override-note{font-size:10px;color:#7f8a9a;font-weight:700;margin-left:8px}
.tb{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:#fff;border-bottom:1px solid var(--line);flex-shrink:0}.tbl{font-size:12px;font-weight:800;color:#243044}.ss{font-size:11px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}
.list{flex:1;overflow-y:auto;padding:8px 10px}.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:6px;cursor:pointer;transition:border-color 0.12s,box-shadow 0.12s,transform 0.12s;min-width:0}
.card:hover{border-color:var(--gold);box-shadow:0 2px 10px rgba(20,32,52,0.07);transform:translateY(-1px)}.card.sel{border-color:var(--navy);box-shadow:inset 3px 0 0 var(--navy),0 2px 10px rgba(15,31,61,0.08)}
.ch{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;gap:12px}.ca{font-size:13px;font-weight:800;overflow-wrap:anywhere}.cp{font-size:12px;font-weight:800;color:var(--navy);text-align:right;white-space:nowrap}.cm{font-size:10px;color:#768295;margin-top:2px;margin-bottom:5px;line-height:1.25}
.bdgs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}.bdg{font-size:8px;padding:2px 6px;border-radius:999px;font-weight:800}.b1{background:#e1f5ee;color:#085041}.b2{background:#e6f1fb;color:#0c447c}.b3{background:#edf1f5;color:#536071}.b4{background:#faeeda;color:#854f0b}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-bottom:6px}.kp{background:#f6f8fa;border:1px solid #edf1f4;border-radius:6px;padding:4px 6px}.kpl{font-size:8px;color:#7f8a9a;text-transform:uppercase;letter-spacing:0;margin-bottom:1px;font-weight:800}.kpv{font-size:12px;font-weight:800;white-space:nowrap}
.pb{display:flex;align-items:center;gap:7px}.pbl{font-size:10px;color:#7f8a9a;min-width:62px}.pbt{flex:1;height:5px;background:#edf1f5;border-radius:3px;overflow:hidden}.pbf{height:100%;border-radius:3px}.pbv{font-size:10px;font-weight:800;min-width:58px;text-align:right;white-space:nowrap}
.empty{text-align:center;padding:34px 16px;color:#7f8a9a;font-size:12px}.sw{text-align:center;padding:34px;color:#7f8a9a;font-size:12px}.spin{width:26px;height:26px;border:3px solid #e7edf4;border-top-color:var(--navy);border-radius:50%;animation:sp 0.8s linear infinite;margin:0 auto 9px}@keyframes sp{to{transform:rotate(360deg)}}
.detail{position:fixed;right:0;top:48px;width:min(560px,46vw);max-width:100vw;height:calc(100vh - 48px);background:#fff;border-left:1px solid var(--line);overflow-y:auto;overflow-x:hidden;transform:translateX(100%);transition:transform 0.2s;z-index:50;box-shadow:-10px 0 30px rgba(15,31,61,0.14)}.detail.open{transform:translateX(0)}
.settings{position:fixed;inset:0;background:rgba(15,31,61,.42);display:none;align-items:flex-start;justify-content:center;padding:70px 16px 16px;z-index:200;overflow:auto}.settings.open{display:flex}.settings-panel{width:min(820px,100%);background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 18px 50px rgba(15,31,61,.25);overflow:hidden}.settings-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);background:#f8fafc}.settings-head h3{font-size:14px;color:var(--navy)}.settings-head p{font-size:10px;color:#6f7b8c;margin-top:2px}.settings-body{padding:12px 14px}.settings-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.setfield{border:1px solid var(--line);border-radius:8px;padding:8px;background:#fbfcfd}.setfield label{display:block;font-size:8px;font-weight:900;text-transform:uppercase;color:#7f8a9a;margin-bottom:5px}.setfield .mfr input{font-size:12px}.setnote{font-size:10px;color:#6f7b8c;line-height:1.35;margin:10px 0 0}.setactions{display:flex;justify-content:flex-end;gap:7px;padding:10px 14px;border-top:1px solid var(--line);background:#f8fafc}.setactions button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:7px 10px;font-size:11px;font-weight:800;cursor:pointer;color:#536071}.setactions button.primary{background:var(--navy);border-color:var(--navy);color:#fff}.setactions button.warn{color:#8a5b06;background:#fffaf0;border-color:#ead7a6}
.dh{padding:9px 12px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:2}.dht{font-size:12px;font-weight:800;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px}.dha{display:flex;gap:5px;flex-shrink:0}.da{padding:5px 8px;font-size:9px;font-weight:800;border:1px solid var(--line);border-radius:5px;cursor:pointer;background:#fff;color:#536071}.da.p{background:var(--navy);color:#fff;border-color:var(--navy)}.dhx{background:none;border:none;font-size:18px;cursor:pointer;color:#8792a2;padding:0 2px;flex-shrink:0}
.db{padding:10px 12px}.sh{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0;color:#8390a2;margin:10px 0 5px}.sh:first-child{margin-top:0}.ig{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:6px}.ic{background:#f7f9fb;border:1px solid #edf1f4;border-radius:6px;padding:6px 8px}.icl{font-size:8px;color:#7f8a9a;margin-bottom:2px;text-transform:uppercase;font-weight:800}.icv{font-size:11px;font-weight:800;overflow-wrap:anywhere}
.mbg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-bottom:5px}.mb{background:#f7f9fb;border:1px solid #edf1f4;border-radius:6px;padding:7px 8px;border-left:3px solid #ddd}.mbl{font-size:8px;color:#7f8a9a;margin-bottom:2px;text-transform:uppercase;font-weight:800}.mbv{font-size:15px;font-weight:900}.mbs{font-size:8px;color:#7f8a9a;margin-top:1px;line-height:1.15}
.ct{width:100%;font-size:11px;border-collapse:collapse}.ct td{padding:5px 0;border-bottom:0.5px solid #edf1f4}.ct td:last-child{text-align:right;font-weight:800}.ct tr.tot td{font-weight:900;border-top:1px solid #d8dee7;border-bottom:none;padding-top:6px}.wfr{margin-bottom:5px}.wfl{display:flex;justify-content:space-between;font-size:9px;color:#4d5969;margin-bottom:2px}.wft{height:8px;background:#edf1f5;border-radius:3px;overflow:hidden}.wff{height:100%;border-radius:3px}
.nb{background:#fffbf0;border:1px solid #f0e0b0;border-left:3px solid var(--gold);border-radius:7px;padding:9px 11px;font-size:11px;line-height:1.55;color:#3f4a5a;margin-top:6px}.gb{padding:7px 12px;background:var(--gold);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;margin-top:5px}.ab{width:100%;padding:8px;border:none;border-radius:7px;font-size:12px;font-weight:800;cursor:pointer;margin-top:6px}.ap{background:var(--navy);color:#fff}.as{background:#fff;color:var(--navy);border:1px solid var(--navy)}
.maptabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-bottom:5px}.mapbtn{border:1px solid var(--line);background:#fff;color:#536071;border-radius:6px;padding:5px 4px;font-size:9px;font-weight:800;cursor:pointer}.mapbtn.on{background:var(--navy);border-color:var(--navy);color:#fff}.mapcard{display:block;border-radius:8px;overflow:hidden;border:1px solid var(--line);margin-bottom:5px;background:#fff;text-decoration:none}.mapcard img{width:100%;height:152px;object-fit:cover;display:block}.mapcap{padding:5px 8px;font-size:9px;color:#536071;background:#f8fafc;border-top:1px solid var(--line)}.maplinks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-bottom:6px}.maplinks a{border:1px solid var(--line);border-radius:6px;padding:5px 6px;font-size:9px;font-weight:800;text-align:center;color:var(--navy);text-decoration:none;background:#fff}.maplinks a:hover{border-color:var(--gold);background:#fffdf7}
.viewtabs{display:flex;gap:4px;margin-left:auto}.viewbtn{border:1px solid var(--line);background:#fff;color:#536071;border-radius:6px;padding:5px 8px;font-size:10px;font-weight:800;cursor:pointer}.viewbtn.on{background:var(--navy);border-color:var(--navy);color:#fff}.watchbtn{border:1px solid var(--line);background:#fff;color:#536071;border-radius:6px;padding:4px 6px;font-size:9px;font-weight:800;cursor:pointer;white-space:nowrap}.watchbtn.on{background:#fff7df;border-color:var(--gold);color:#7a5108}.mapview{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:10px;min-height:100%;padding-bottom:8px}.mapstage{position:relative;min-height:560px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#dce5ed}.mapstage img{width:100%;height:100%;min-height:560px;object-fit:cover;display:block;filter:saturate(.95) contrast(.98)}.pin{position:absolute;width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 9px rgba(15,31,61,.35);transform:translate(-50%,-50%);cursor:pointer}.pin:hover{z-index:5;transform:translate(-50%,-50%) scale(1.12)}.pin:after{display:none!important}.pintip{position:absolute;left:21px;top:-18px;width:224px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px;box-shadow:0 10px 25px rgba(15,31,61,.2);text-align:left;color:var(--ink);font-size:10px;line-height:1.25;display:none;pointer-events:none}.pin:hover .pintip{display:block}.pintip b{display:block;font-size:11px;margin-bottom:2px;overflow-wrap:anywhere}.pintip em{display:block;font-style:normal;color:#6f7b8c;margin-bottom:6px}.pintip span{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #edf1f4;padding-top:4px;margin-top:4px}.pintip strong{font-size:10px}.transitdot{position:absolute;width:10px;height:10px;border-radius:50%;background:#0f1f3d;border:2px solid #fff;box-shadow:0 1px 5px rgba(15,31,61,.3);transform:translate(-50%,-50%)}.maplegend{position:absolute;left:10px;bottom:10px;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:8px;padding:8px;font-size:10px;color:#4d5969;display:grid;gap:4px}.maplegend span{display:flex;align-items:center;gap:5px}.dot{width:9px;height:9px;border-radius:50%;display:inline-block}.mapside{display:flex;flex-direction:column;gap:8px}.layerbox,.topbox{background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px}.layerbox h4,.topbox h4{font-size:9px;text-transform:uppercase;color:#7f8a9a;margin-bottom:7px}.layerbtn{width:100%;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line);background:#fff;border-radius:6px;padding:6px 7px;margin-bottom:5px;font-size:10px;font-weight:800;color:#536071;cursor:pointer}.layerbtn.on{border-color:var(--navy);color:var(--navy);background:#f6f8fb}.topdeal{border-top:1px solid #edf1f4;padding:7px 0;cursor:pointer}.topdeal:first-of-type{border-top:none}.topdeal b{font-size:11px}.topdeal span{display:block;font-size:10px;color:#6f7b8c;margin-top:2px}.readbox{display:grid;gap:5px;margin:5px 0 8px}.readitem{border:1px solid var(--line);border-left:3px solid #8994a5;border-radius:7px;padding:7px 8px;font-size:11px;line-height:1.35;color:#3f4a5a}.readitem span{font-size:8px;font-weight:900;text-transform:uppercase;margin-right:6px}.readitem.pass{border-left-color:var(--green);background:#f2fbf7}.readitem.watch{border-left-color:var(--amber);background:#fffaf1}.readitem.risk{border-left-color:var(--red);background:#fff6f6}.scn tr.selrow td{background:#fffaf1}.sourcelinks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.sourcelinks a{border:1px solid var(--line);border-radius:6px;padding:5px 6px;font-size:9px;font-weight:800;text-align:center;color:var(--navy);text-decoration:none;background:#fff}
@media(max-width:980px){.detail{width:62vw}.ig{grid-template-columns:1fr 1fr}.mbg{grid-template-columns:1fr 1fr}.mfb{grid-template-columns:1fr 1fr}.settings-grid{grid-template-columns:1fr 1fr}.mapview{grid-template-columns:1fr}.mapside{display:grid;grid-template-columns:1fr 1fr}}
@media(max-width:700px){.sb{display:none}.nav{padding:0 12px}.ntag,.albl{display:none}.mfb{grid-template-columns:1fr 1fr}.detail{left:0;right:0;width:100vw;border-left:none}.kpis,.ig,.mbg{grid-template-columns:1fr 1fr}.dha{max-width:150px}.list{padding:8px}.mapstage,.mapstage img{min-height:420px}.mapside{display:flex}.sourcelinks{grid-template-columns:1fr 1fr}}
@media(max-width:430px){.mfb{grid-template-columns:1fr}.detail{top:48px}.dh{align-items:flex-start}.dha{max-width:112px}.da{padding:4px 6px}.db{padding:10px}.kpis,.ig,.mbg,.maplinks,.sourcelinks,.settings-grid{grid-template-columns:1fr}.viewtabs{width:100%;margin-left:0}.viewbtn{flex:1}}
</style>
<nav class="nav">
  <div class="logo">PARCEL<span>LA</span></div>
  <div class="ntag">LA Development Sites</div>
  <div class="nav-r"><button class="navbtn" onclick="openSettings()">Settings</button><span class="adot" id="adot"></span><span class="albl" id="albl">Connecting...</span></div>
</nav>
<div class="layout">
  <div class="sb">
    <div class="sb-body">
      <h4>Listing type</h4>
      <label class="cb"><input type="checkbox" id="f-fs" checked> For sale</label>
      <label class="cb"><input type="checkbox" id="f-rti" checked> RTI / Entitled</label>
      <label class="cb"><input type="checkbox" id="f-comp" checked> Off-market / not for sale</label>
      <label class="cb"><input type="checkbox" id="f-watch"> Watchlist only</label>
      <h4>Development status</h4>
      <label class="cb"><input type="checkbox" id="f-d-submitted" checked> Submitted</label>
      <label class="cb"><input type="checkbox" id="f-d-plan" checked> Plan check</label>
      <label class="cb"><input type="checkbox" id="f-d-approved" checked> City approved / not started</label>
      <label class="cb"><input type="checkbox" id="f-d-issued" checked> Permit issued</label>
      <label class="cb"><input type="checkbox" id="f-d-unknown" checked> Started / unknown</label>
      <h4>Project type</h4>
      <label class="cb"><input type="checkbox" id="f-mf" checked> Multifamily</label>
      <label class="cb"><input type="checkbox" id="f-mx" checked> Mixed-use</label>
      <label class="cb"><input type="checkbox" id="f-cn" checked> Condo / TH</label>
      <label class="cb"><input type="checkbox" id="f-nh" checked> New house</label>
      <h4>Neighborhood</h4>
      <select id="f-hood" class="sbs">
        <option value="">All neighborhoods</option>
        <option>Silver Lake</option><option>Echo Park</option><option>Highland Park</option>
        <option>Los Feliz</option><option>Koreatown</option><option>Mid-Wilshire</option>
        <option>Culver City</option><option>Mar Vista</option><option>West Adams</option>
        <option>Boyle Heights</option>
      </select>
      <h4>Zoning</h4>
      <select id="f-zone" class="sbs">
        <option value="">All zones</option>
        <option>R2</option><option>R3</option><option>R4</option><option>RD1.5</option>
        <option>C2</option><option>C4</option><option>[Q]C2</option>
      </select>
      <h4>Units</h4>
      <div class="sb2"><input type="number" id="f-umin" placeholder="Min"><input type="number" id="f-umax" placeholder="Max"></div>
      <h4>Land price</h4>
      <div class="sb2"><input type="number" id="f-pmin" placeholder="Min $"><input type="number" id="f-pmax" placeholder="Max $"></div>
    </div>
    <div class="sbf">
      <button class="bp" onclick="applyFilters()">Search</button>
      <button class="br" onclick="resetFilters()">Reset filters</button>
    </div>
  </div>
  <div class="main">
    <div class="mfb">
      <div class="mf"><div class="mfl">Min net profit</div><div class="mfr"><span>$</span><input type="number" id="mf-p" placeholder="0" step="100000"><span>K</span></div></div>
      <div class="mf"><div class="mfl">Min IRR</div><div class="mfr"><input type="number" id="mf-i" placeholder="0" step="1"><span>%</span></div></div>
      <div class="mf"><div class="mfl">Min dev spread</div><div class="mfr"><input type="number" id="mf-s" placeholder="0" step="1"><span>%</span></div></div>
      <div class="mf"><div class="mfl">Min cap on cost</div><div class="mfr"><input type="number" id="mf-c" placeholder="0" step="0.25"><span>%</span></div></div>
      <div class="mf" id="plan-box"><div class="mfl">Construction plan</div><select class="sbs" id="mf-plan" onchange="applyFilters()" style="margin:0;padding:3px 4px;font-size:10px"><option value="auto">Auto by type</option><option value="value">Value engineered</option><option value="typev">Type V wood frame</option><option value="modular">Modular / prefab</option><option value="podium">Type III podium</option><option value="luxury">Luxury finish</option><option value="concrete">Concrete / steel</option></select></div>
      <div class="mf" id="hc-box"><div class="mfl">Your hard cost / SF</div><div class="mfr"><span>$</span><input type="number" id="mf-hc" placeholder="RSMeans" step="5"><button class="mfa" onclick="applyHardCostOverride()">Run</button></div></div>
    </div>
    <div class="tb">
      <span class="tbl" id="rct">Loading sites...</span>
      <div class="viewtabs">
        <button class="viewbtn on" id="view-list" onclick="setView('list')">List</button>
        <button class="viewbtn" id="view-map" onclick="setView('map')">Map</button>
      </div>
      <select class="ss" id="srt" onchange="applyFilters()">
        <option value="profit">Net profit ↓</option><option value="irr">IRR ↓</option>
        <option value="spread">Dev spread ↓</option><option value="capoc">Cap on cost ↓</option>
        <option value="price-a">Price ↑</option><option value="price-d">Price ↓</option>
        <option value="units">Most units</option>
      </select>
    </div>
    <div class="list" id="list"></div>
  </div>
</div>
<div class="detail" id="detail">
  <div class="dh">
    <span class="dht" id="d-title">Analysis</span>
    <div class="dha">
      <button class="da" onclick="shareDeal()">⤴ Share</button>
      <button class="da" onclick="exportExcel(openId)">Excel</button>
      <button class="da p" onclick="exportPDF(openId)">↓ PDF</button>
    </div>
    <button class="dhx" onclick="closeDetail()">×</button>
  </div>
  <div class="db" id="d-body"></div>
</div>
<div class="settings" id="settings">
  <div class="settings-panel">
    <div class="settings-head">
      <div><h3>Underwriting Settings</h3><p>Saved in this browser and applied across every site, export, and scenario.</p></div>
      <button class="dhx" onclick="closeSettings()">×</button>
    </div>
    <div class="settings-body">
      <div class="settings-grid">
        <div class="setfield"><label>Multifamily hard cost / SF</label><div class="mfr"><span>$</span><input type="number" id="set-hc-mf" step="5"></div></div>
        <div class="setfield"><label>Mixed-use hard cost / SF</label><div class="mfr"><span>$</span><input type="number" id="set-hc-mx" step="5"></div></div>
        <div class="setfield"><label>Condo / TH hard cost / SF</label><div class="mfr"><span>$</span><input type="number" id="set-hc-cn" step="5"></div></div>
        <div class="setfield"><label>New house hard cost / SF</label><div class="mfr"><span>$</span><input type="number" id="set-hc-nh" step="5"></div></div>
        <div class="setfield"><label>Soft costs / hard costs</label><div class="mfr"><input type="number" id="set-soft" step="0.5"><span>%</span></div></div>
        <div class="setfield"><label>Loan-to-cost</label><div class="mfr"><input type="number" id="set-ltc" step="1"><span>%</span></div></div>
        <div class="setfield"><label>Interest rate</label><div class="mfr"><input type="number" id="set-rate" step="0.1"><span>%</span></div></div>
        <div class="setfield"><label>Vacancy</label><div class="mfr"><input type="number" id="set-vacancy" step="0.5"><span>%</span></div></div>
        <div class="setfield"><label>Operating expenses / EGI</label><div class="mfr"><input type="number" id="set-expense" step="0.5"><span>%</span></div></div>
        <div class="setfield"><label>Annual rent growth</label><div class="mfr"><input type="number" id="set-growth" step="0.25"><span>%</span></div></div>
        <div class="setfield"><label>Exit cap spread</label><div class="mfr"><input type="number" id="set-exit-spread" step="5"><span>bps</span></div></div>
      </div>
      <div class="setnote">Changing these assumptions immediately re-underwrites the deal list, detail screen, map hover cards, Excel workbook, and PDF memo. The top-row hard-cost override still works as a quick one-off stress test.</div>
    </div>
    <div class="setactions">
      <button class="warn" onclick="resetSettings()">Reset defaults</button>
      <button onclick="closeSettings()">Cancel</button>
      <button class="primary" onclick="saveSettings()">Save & re-underwrite</button>
    </div>
  </div>
</div>`;

async function boot() {
  try {
    const r = await fetch(API + '/api/health');
    if (r.ok) { g('adot').className = 'adot ok'; g('albl').textContent = 'Live'; }
    else { g('albl').textContent = 'Error'; }
  } catch { g('albl').textContent = 'Offline'; }
  await loadSites();
}

function currentHardCostOverride() {
  const val = Number(g('mf-hc')?.value || 0);
  return val > 0 ? Math.round(val) : 0;
}

function currentConstructionPlan() {
  const key = g('mf-plan')?.value || 'auto';
  return { key, ...(CONSTRUCTION_PLANS[key] || CONSTRUCTION_PLANS.auto) };
}

function signedPlanPct(value) {
  const pct = Math.round((value || 0) * 1000) / 10;
  return pct > 0 ? '+' + pct + '%' : pct + '%';
}

function planByKey(key) {
  return { key, ...(CONSTRUCTION_PLANS[key] || CONSTRUCTION_PLANS.auto) };
}

function loadUserMetrics() {
  try {
    const saved = JSON.parse(localStorage.getItem('parcella_user_metrics') || '{}');
    if (saved.hardCostSfrAdu && !saved.hardCostNewHouse) saved.hardCostNewHouse = saved.hardCostSfrAdu;
    return { ...DEFAULT_USER_METRICS, ...saved };
  } catch {
    return { ...DEFAULT_USER_METRICS };
  }
}

function currentUserMetrics() {
  return { ...DEFAULT_USER_METRICS, ...(userMetrics || {}) };
}

function saveUserMetrics() {
  localStorage.setItem('parcella_user_metrics', JSON.stringify(currentUserMetrics()));
}

function metricNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function metricsCustomized() {
  const m = currentUserMetrics();
  return Object.keys(DEFAULT_USER_METRICS).some(key => Number(m[key]) !== Number(DEFAULT_USER_METRICS[key]));
}

function setSettingsField(id, value) {
  const el = g(id);
  if (el) el.value = value;
}

function populateSettingsForm() {
  const m = currentUserMetrics();
  setSettingsField('set-hc-mf', m.hardCostMultifamily);
  setSettingsField('set-hc-mx', m.hardCostMixedUse);
  setSettingsField('set-hc-cn', m.hardCostCondoTH);
  setSettingsField('set-hc-nh', m.hardCostNewHouse);
  setSettingsField('set-soft', m.baseSoftCostPct);
  setSettingsField('set-ltc', m.loanToCostPct);
  setSettingsField('set-rate', m.interestRatePct);
  setSettingsField('set-vacancy', m.vacancyPct);
  setSettingsField('set-expense', m.expenseRatioPct);
  setSettingsField('set-growth', m.rentGrowthPct);
  setSettingsField('set-exit-spread', m.exitCapSpreadBps);
}

function openSettings() {
  populateSettingsForm();
  g('settings')?.classList.add('open');
}

function closeSettings() {
  g('settings')?.classList.remove('open');
}

function refreshUnderwritingViews() {
  const id = openId;
  applyFilters();
  if (id) {
    const s = allSites.find(x => x.id === id);
    if (s) renderDetail(s);
  }
}

function saveSettings() {
  const current = currentUserMetrics();
  userMetrics = {
    hardCostMultifamily: metricNumber(g('set-hc-mf')?.value, current.hardCostMultifamily, 100, 1000),
    hardCostMixedUse: metricNumber(g('set-hc-mx')?.value, current.hardCostMixedUse, 100, 1000),
    hardCostCondoTH: metricNumber(g('set-hc-cn')?.value, current.hardCostCondoTH, 100, 1000),
    hardCostNewHouse: metricNumber(g('set-hc-nh')?.value, current.hardCostNewHouse, 100, 1000),
    baseSoftCostPct: metricNumber(g('set-soft')?.value, current.baseSoftCostPct, 5, 45),
    loanToCostPct: metricNumber(g('set-ltc')?.value, current.loanToCostPct, 0, 90),
    interestRatePct: metricNumber(g('set-rate')?.value, current.interestRatePct, 0, 20),
    vacancyPct: metricNumber(g('set-vacancy')?.value, current.vacancyPct, 0, 30),
    expenseRatioPct: metricNumber(g('set-expense')?.value, current.expenseRatioPct, 5, 70),
    rentGrowthPct: metricNumber(g('set-growth')?.value, current.rentGrowthPct, -10, 12),
    exitCapSpreadBps: metricNumber(g('set-exit-spread')?.value, current.exitCapSpreadBps, -100, 200),
  };
  saveUserMetrics();
  closeSettings();
  refreshUnderwritingViews();
}

function resetSettings() {
  userMetrics = { ...DEFAULT_USER_METRICS };
  saveUserMetrics();
  populateSettingsForm();
  refreshUnderwritingViews();
}

function metricRate(key) {
  return (Number(currentUserMetrics()[key]) || 0) / 100;
}

function siteAskPrice(s) {
  return Number(s?.askPrice || s?.price || 0);
}

function isForSaleSite(s) {
  return !s?.isComp && siteAskPrice(s) > 0;
}

function isOffMarketSite(s) {
  const status = String(s?.status || s?.listingStatus || '').toLowerCase();
  return !!(s?.isComp || s?.offMarket || status.includes('off') || status.includes('not for sale') || !siteAskPrice(s));
}

function siteListingStatus(s) {
  if (isOffMarketSite(s)) return 'Off-market / not for sale';
  return 'For sale';
}

function developmentStatusKey(s) {
  const explicit = String(s?.developmentStatus || '').trim();
  if (['submitted','plan_check','city_approved_not_started','permit_issued','possibly_started_unknown'].includes(explicit)) return explicit;
  const raw = String(s?.permitStatus || s?.permit_status || '').toLowerCase();
  if (raw.includes('not ready')) return 'plan_check';
  if (s?.rti || raw.includes('ready') || raw.includes('approved')) return 'city_approved_not_started';
  if (raw.includes('submit')) return 'submitted';
  if (raw.includes('plan') || raw.includes('pc ') || raw.includes('pc_') || raw.includes('correction') || raw.includes('verification') || raw.includes('review') || raw.includes('hold')) return 'plan_check';
  if (raw.includes('issued')) return 'permit_issued';
  return 'possibly_started_unknown';
}

function developmentStatusLabel(s) {
  return {
    submitted: 'Submitted',
    plan_check: 'Plan check',
    city_approved_not_started: 'City approved / not started',
    permit_issued: 'Permit issued',
    possibly_started_unknown: 'Started / unknown',
  }[developmentStatusKey(s)] || 'Started / unknown';
}

function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem('parcella_watchlist') || '[]'); }
  catch { return []; }
}

function saveWatchlist() {
  localStorage.setItem('parcella_watchlist', JSON.stringify(watchlist));
}

function isWatched(id) {
  return watchlist.includes(Number(id));
}

function toggleWatch(id, ev) {
  if (ev) ev.stopPropagation();
  id = Number(id);
  watchlist = isWatched(id) ? watchlist.filter(x => x !== id) : [...watchlist, id];
  saveWatchlist();
  renderCards();
  if (openId === id) renderDetail(allSites.find(x => x.id === id));
}

function cityMapURL(maptype='roadmap') {
  return `https://maps.googleapis.com/maps/api/staticmap?size=960x620&scale=2&center=34.0522,-118.2851&zoom=10&maptype=${maptype}&key=${GMAPS_KEY}`;
}

function siteCoords(s) {
  if (Number(s?.lat) && Number(s?.lng)) return { lat:Number(s.lat), lng:Number(s.lng) };
  const base = HOOD_COORDS[s?.hood] || { lat:34.0522, lng:-118.2851 };
  const n = Number(s?.id || 0);
  return {
    lat: base.lat + (((n * 7) % 11) - 5) * 0.0025,
    lng: base.lng + (((n * 5) % 11) - 5) * 0.0035,
  };
}

function mapPoint(lat, lng) {
  const x = Math.max(3, Math.min(97, ((lng - LA_MAP_BOUNDS.minLng) / (LA_MAP_BOUNDS.maxLng - LA_MAP_BOUNDS.minLng)) * 100));
  const y = Math.max(3, Math.min(97, (1 - ((lat - LA_MAP_BOUNDS.minLat) / (LA_MAP_BOUNDS.maxLat - LA_MAP_BOUNDS.minLat))) * 100));
  return { x, y };
}

function siteMapPoint(s) {
  const c = siteCoords(s);
  return mapPoint(c.lat, c.lng);
}

function markerColorForSite(s, valuation) {
  if (isWatched(s.id)) return '#b98b2f';
  if ((valuation?.netProfit || 0) > 500000) return '#1d9e75';
  if (developmentStatusKey(s) === 'city_approved_not_started') return '#378add';
  if (developmentStatusKey(s) === 'plan_check') return '#ef9f27';
  if (isOffMarketSite(s)) return '#8994a5';
  return '#ef9f27';
}

function visibleOnMapLayer(s) {
  if (isWatched(s.id) && mapLayers.watchlist) return true;
  if (developmentStatusKey(s) === 'city_approved_not_started' || s.rti) return mapLayers.rti;
  if (isForSaleSite(s)) return mapLayers.forSale;
  if (isOffMarketSite(s)) return mapLayers.offMarket;
  return mapLayers.offMarket;
}

function toggleMapLayer(layer) {
  mapLayers[layer] = !mapLayers[layer];
  renderCards();
}

function scenarioForSite(s, key) {
  const plan = planByKey(key);
  const costs = costModelForSite(s, plan);
  const income = incomeStatementForSite(s, costs, plan);
  const valuation = valuationForSite(s, costs, income);
  return { key, plan, costs, income, valuation };
}

function scenarioListForSite(s) {
  return ['value','typev','modular','podium','luxury','concrete'].map(key => scenarioForSite(s, key));
}

function selectedScenarioKey() {
  return currentConstructionPlan().key === 'auto' ? 'typev' : currentConstructionPlan().key;
}

function scenarioComparisonHTML(s) {
  const selected = selectedScenarioKey();
  return `<table class="ct scn">
    <tr><td>Plan</td><td>Hard/SF</td><td>Total/unit</td><td>Net profit</td></tr>
    ${scenarioListForSite(s).map(row => {
      const pc = row.valuation.netProfit >= 0 ? '#1d9e75' : '#e24b4a';
      return `<tr class="${row.key===selected?'selrow':''}">
        <td>${row.plan.label}</td>
        <td>${fmtD(row.costs.hardPerSf)}</td>
        <td>${fmtD(row.costs.totalPerUnit)}</td>
        <td style="color:${pc}">${fmtM(row.valuation.netProfit)}</td>
      </tr>`;
    }).join('')}
  </table>`;
}

function pencilReadItems(s, costs, income, valuation) {
  const items = [];
  const marketCap = valuation.entryCap * 100;
  const exitCap = valuation.exitCap * 100;
  const spread = Math.round((valuation.devSpreadPct || 0) * 1000) / 10;
  items.push({
    status: valuation.netProfit >= 0 ? 'Pass' : 'Risk',
    text: valuation.netProfit >= 0
      ? `Creates ${fmtM(valuation.netProfit)} above all-in cost.`
      : `Needs ${fmtM(Math.abs(valuation.netProfit))} of value improvement to break even.`,
  });
  items.push({
    status: valuation.capOnCost >= marketCap ? 'Pass' : 'Risk',
    text: `Cap on cost is ${valuation.capOnCost}% versus about ${marketCap.toFixed(2)}% market entry cap.`,
  });
  items.push({
    status: spread >= 10 ? 'Pass' : spread >= 0 ? 'Watch' : 'Risk',
    text: `Development spread is ${spread}%.`,
  });
  items.push({
    status: costs.hardPerSf <= 325 ? 'Pass' : costs.hardPerSf <= 380 ? 'Watch' : 'Risk',
    text: `Hard cost is ${fmtD(costs.hardPerSf)}/SF under the ${costs.planLabel} plan.`,
  });
  items.push({
    status: income.noi > 0 ? 'Pass' : 'Risk',
    text: `Stabilized NOI is ${fmtD(income.noi)} and exit cap is ${exitCap.toFixed(2)}%.`,
  });
  return items;
}

function pencilReadHTML(s, costs, income, valuation) {
  return `<div class="readbox">
    ${pencilReadItems(s, costs, income, valuation).map(item => `<div class="readitem ${item.status.toLowerCase()}"><span>${item.status}</span>${item.text}</div>`).join('')}
  </div>`;
}

function sourceLinksHTML(s) {
  const links = [
    ['LA City Open Data', 'https://data.lacity.org/'],
    ['ZIMAS zoning', officialResearchLink(s.addr, 'ZIMAS zoning')],
    ['LADBS permits', officialResearchLink(s.addr, 'LADBS permits PCIS')],
    ['Google Maps', mapsLink(s.addr)],
    ['County recorder', officialResearchLink(s.addr, 'Los Angeles county recorder deed sale')],
  ];
  return `<div class="sourcelinks">${links.map(([label, href]) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`).join('')}</div>`;
}

async function loadSites() {
  g('list').innerHTML = '<div class="sw"><div class="spin"></div>Underwriting sites...</div>';
  try {
    const hcpsf = currentHardCostOverride();
    const qs = new URLSearchParams({ limit: '2000', sort: 'profit' });
    if (hcpsf) qs.set('hcpsf', String(hcpsf));
    const r = await fetch(API + '/api/sites?' + qs.toString());
    if (!r.ok) throw new Error('API ' + r.status);
    const data = await r.json();
    allSites = data.results || [];
    updateHardCostOverrideUI();
    console.log('[ParceLLA] Loaded', allSites.length, 'sites, first:', JSON.stringify(allSites[0]?.addr));
    console.log('[ParceLLA] Sample site type:', allSites[0]?.type, 'rti:', allSites[0]?.rti, 'isComp:', allSites[0]?.isComp);
    applyFilters();
    console.log('[ParceLLA] After filter:', filtered.length, 'sites visible');
  } catch (e) {
    g('list').innerHTML = '<div class="empty">Could not load sites<br><small style="color:#e24b4a">' + e.message + '</small></div>';
  }
}

function applyFilters() {
  const hood = g('f-hood')?.value||'', zone = g('f-zone')?.value||'';
  const umin = +g('f-umin')?.value||0, umax = +g('f-umax')?.value||Infinity;
  const pmin = +g('f-pmin')?.value||0, pmax = +g('f-pmax')?.value||Infinity;
  const mfp = (+g('mf-p')?.value||0)*1000, mfi = +g('mf-i')?.value||0;
  const mfs = +g('mf-s')?.value||0, mfc = +g('mf-c')?.value||0;
  const srt = g('srt')?.value||'profit';
  const ffs = g('f-fs')?.checked!==false, frti = g('f-rti')?.checked!==false, fcomp = g('f-comp')?.checked!==false;
  const watchOnly = g('f-watch')?.checked === true;
  const devStatuses = [];
  if (g('f-d-submitted')?.checked) devStatuses.push('submitted');
  if (g('f-d-plan')?.checked) devStatuses.push('plan_check');
  if (g('f-d-approved')?.checked) devStatuses.push('city_approved_not_started');
  if (g('f-d-issued')?.checked) devStatuses.push('permit_issued');
  if (g('f-d-unknown')?.checked) devStatuses.push('possibly_started_unknown');
  const types = [];
  if (g('f-mf')?.checked) types.push('Multifamily');
  if (g('f-mx')?.checked) types.push('Mixed-Use');
  if (g('f-cn')?.checked) types.push('Condo/TH');
  if (g('f-nh')?.checked) types.push('New House');

  filtered = allSites.filter(s => {
    const valuation = valuationForSite(s, costModelForSite(s));
    const listingMatch = (ffs && isForSaleSite(s)) || (frti && s.rti) || (fcomp && isOffMarketSite(s));
    if (!listingMatch) return false;
    const devKey = developmentStatusKey(s);
    const devMatch = devStatuses.includes(devKey) || (devStatuses.includes('city_approved_not_started') && s.rti);
    if (!devStatuses.length) return false;
    if (devStatuses.length && !devMatch) return false;
    if (watchOnly && !isWatched(s.id)) return false;
    if (!types.length || !types.includes(s.type)) return false;
    if (hood && s.hood !== hood) return false;
    if (zone && s.zone !== zone) return false;
    if (s.units < umin || s.units > umax) return false;
    const ask = siteAskPrice(s);
    if (isForSaleSite(s) && ask && (ask < pmin || ask > pmax)) return false;
    if (mfp && (valuation.netProfit||0) < mfp) return false;
    if (mfi && (s.irrV||0) < mfi) return false;
    if (mfs && ((valuation.devSpreadPct||0)*100) < mfs) return false;
    if (mfc && (valuation.capOnCost||0) < mfc) return false;
    return true;
  });

  filtered.sort((a,b) => {
    if (srt==='irr')     return (b.irrV||0)-(a.irrV||0);
    if (srt==='spread')  return (valuationForSite(b, costModelForSite(b)).devSpreadPct||0)-(valuationForSite(a, costModelForSite(a)).devSpreadPct||0);
    if (srt==='capoc')   return (valuationForSite(b, costModelForSite(b)).capOnCost||0)-(valuationForSite(a, costModelForSite(a)).capOnCost||0);
    if (srt==='price-a') return (siteAskPrice(a)||Infinity)-(siteAskPrice(b)||Infinity);
    if (srt==='price-d') return (siteAskPrice(b)||0)-(siteAskPrice(a)||0);
    if (srt==='units')   return b.units-a.units;
    return (valuationForSite(b, costModelForSite(b)).netProfit||0)-(valuationForSite(a, costModelForSite(a)).netProfit||0);
  });

  const hcpsf = currentHardCostOverride();
  const plan = currentConstructionPlan();
  const planText = plan.key === 'auto' ? '' : ' - ' + plan.label;
  const settingsText = metricsCustomized() ? ' - custom assumptions' : '';
  updateHardCostOverrideUI();
  g('rct').textContent = filtered.length + ' site' + (filtered.length!==1?'s':'') + (hcpsf ? ' - re-underwritten at $' + hcpsf.toLocaleString() + '/SF hard cost' : (planText || ' - pre-underwritten') + settingsText);
  renderCards();
}

function setView(view) {
  activeView = view === 'map' ? 'map' : 'list';
  const listBtn = g('view-list'), mapBtn = g('view-map');
  if (listBtn) listBtn.classList.toggle('on', activeView === 'list');
  if (mapBtn) mapBtn.classList.toggle('on', activeView === 'map');
  renderCards();
}

async function applyHardCostOverride() {
  const input = g('mf-hc');
  const val = Number(input?.value || 0);
  if (val && (val < 100 || val > 1000)) {
    alert('Enter a hard cost between $100 and $1,000 per SF.');
    input.focus();
    return;
  }
  await loadSites();
}

async function clearHardCostOverride() {
  const input = g('mf-hc');
  if (input) input.value = '';
  await loadSites();
}

function updateHardCostOverrideUI() {
  const hcpsf = currentHardCostOverride();
  const box = g('hc-box');
  if (box) box.classList.toggle('active', !!hcpsf);
  const planBox = g('plan-box');
  if (planBox) planBox.classList.toggle('active', currentConstructionPlan().key !== 'auto');
}

function renderCards() {
  const el = g('list');
  if (!filtered.length) { el.innerHTML = '<div class="empty">No sites match your filters</div>'; return; }
  if (activeView === 'map') { renderMapView(); return; }
  const maxP = Math.max(...filtered.map(s => valuationForSite(s, costModelForSite(s)).netProfit || 0), 1);
  el.innerHTML = filtered.map(s => {
    const costs = costModelForSite(s);
    const valuation = valuationForSite(s, costs);
    const irr=s.irrV||0, prof=valuation.netProfit||0;
    const pc = prof>1e6?'#1d9e75':prof>0?'#ef9f27':'#e24b4a';
    const pp = Math.max(0,Math.round(prof/maxP*100));
    const spd = Math.round((valuation.devSpreadPct||0)*1000)/10;
    const hcpsf = currentHardCostOverride();
    const plan = currentConstructionPlan();
    const ask = siteAskPrice(s);
    const landBasis = s.landCost || ask || 0;
    const offMarket = isOffMarketSite(s);
    const status = siteListingStatus(s);
    const devStatus = developmentStatusLabel(s);
    const priceMain = isForSaleSite(s) ? fmtM(ask) : 'Not for sale';
    const priceSub = offMarket ? 'imputed land ' + fmtM(landBasis) : (ask ? 'asking price / land basis' : 'asking price missing');
    const watched = isWatched(s.id);
    return `<div class="card${openId===s.id?' sel':''}" onclick="openDetail(${s.id})">
      <div class="ch">
        <div><div class="ca">${s.addr}</div><div class="cm">${s.hood} &middot; ${s.zone} &middot; ${(s.lot||0).toLocaleString()} SF &middot; ${s.units} units</div></div>
        <div><div class="cp">${priceMain}</div><div style="font-size:10px;color:#768295;text-align:right">${priceSub}</div><button class="watchbtn ${watched?'on':''}" onclick="toggleWatch(${s.id}, event)">${watched?'Saved':'Save'}</button></div>
      </div>
      <div class="bdgs">
        ${s.rti?'<span class="bdg b1">✓ RTI</span>':offMarket?'<span class="bdg b4">Off-market</span>':'<span class="bdg b2">For sale</span>'}
        <span class="bdg b3">${s.type}</span><span class="bdg ${developmentStatusKey(s)==='city_approved_not_started'?'b1':'b4'}">${devStatus}</span>${offMarket?'<span class="bdg b4">' + status + '</span>':''}${plan.key!=='auto'?'<span class="bdg b4">' + plan.label + '</span>':''}${hcpsf?'<span class="bdg b4">$' + hcpsf.toLocaleString() + '/SF hard cost</span>':''}
      </div>
      <div class="kpis">
        <div class="kp"><div class="kpl">Net profit</div><div class="kpv" style="color:${pc}">${fmtM(prof)}</div></div>
        <div class="kp"><div class="kpl">IRR</div><div class="kpv" style="color:${irrC(irr)}">${Math.round(irr*10)/10}%</div></div>
        <div class="kp"><div class="kpl">Dev spread</div><div class="kpv">${spd}%</div></div>
        <div class="kp"><div class="kpl">Cap on cost</div><div class="kpv">${valuation.capOnCost||0}%</div></div>
      </div>
      <div class="pb">
        <span class="pbl">Exit ${fmtM(valuation.exitValue)}</span>
        <div class="pbt"><div class="pbf" style="width:${pp}%;background:${pc}"></div></div>
        <span class="pbv" style="color:${pc}">${fmtM(prof)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderMapView() {
  const el = g('list');
  const visibleSites = filtered.filter(visibleOnMapLayer).slice(0, 250);
  const pins = visibleSites.map(s => {
    const costs = costModelForSite(s);
    const valuation = valuationForSite(s, costs);
    const pt = siteMapPoint(s);
    const color = markerColorForSite(s, valuation);
    const label = `${s.addr} - ${fmtM(valuation.netProfit)}`.replace(/"/g, '');
    const price = isForSaleSite(s) ? fmtM(siteAskPrice(s)) : 'Not for sale';
    const profitColor = (valuation.netProfit || 0) >= 0 ? '#1d9e75' : '#e24b4a';
    return `<button class="pin" data-label="${xmlEscape(label)}" onclick="openDetail(${s.id})" style="left:${pt.x}%;top:${pt.y}%;background:${color}">
      <span class="pintip">
        <b>${xmlEscape(s.addr)}</b>
        <em>${xmlEscape(developmentStatusLabel(s))} · ${s.units || 0} units · ${xmlEscape(s.hood || '')}</em>
        <span><small>Price</small><strong>${price}</strong></span>
        <span><small>Net profit</small><strong style="color:${profitColor}">${fmtM(valuation.netProfit)}</strong></span>
        <span><small>Cap on cost</small><strong>${valuation.capOnCost || 0}%</strong></span>
        <span><small>Hard cost</small><strong>${fmtD(costs.hardPerSf)}/SF</strong></span>
      </span>
    </button>`;
  }).join('');
  const transit = mapLayers.transit ? MAP_TRANSIT_NODES.map(node => {
    const pt = mapPoint(node.lat, node.lng);
    return `<span class="transitdot" title="${node.name}" style="left:${pt.x}%;top:${pt.y}%"></span>`;
  }).join('') : '';
  const topDeals = filtered.slice(0, 6).map(s => {
    const valuation = valuationForSite(s, costModelForSite(s));
    return `<div class="topdeal" onclick="openDetail(${s.id})"><b>${s.addr}</b><span>${s.hood} - ${fmtM(valuation.netProfit)} - ${valuation.capOnCost||0}% cap on cost</span></div>`;
  }).join('');
  el.innerHTML = `<div class="mapview">
    <div class="mapstage">
      <img src="${cityMapURL('roadmap')}" alt="Los Angeles development map">
      ${pins}${transit}
      <div class="maplegend">
        <span><i class="dot" style="background:#1d9e75"></i>Strong profit</span>
        <span><i class="dot" style="background:#378add"></i>City approved / not started</span>
        <span><i class="dot" style="background:#ef9f27"></i>For sale</span>
        <span><i class="dot" style="background:#b98b2f"></i>Watchlist</span>
      </div>
    </div>
    <div class="mapside">
      <div class="layerbox">
        <h4>Map layers</h4>
        ${[
          ['forSale','For sale'],
          ['rti','City approved / RTI'],
          ['offMarket','Off-market'],
          ['watchlist','Watchlist'],
          ['transit','Transit / TOC'],
        ].map(([key,label]) => `<button class="layerbtn ${mapLayers[key]?'on':''}" onclick="toggleMapLayer('${key}')"><span>${label}</span><span>${mapLayers[key]?'On':'Off'}</span></button>`).join('')}
      </div>
      <div class="topbox">
        <h4>Top visible deals</h4>
        ${topDeals || '<div class="empty" style="padding:10px">No visible deals</div>'}
      </div>
    </div>
  </div>`;
}

function openDetail(id) {
  openId = id;
  const s = allSites.find(x => x.id===id);
  if (!s) return;
  g('d-title').textContent = s.addr;
  g('detail').classList.add('open');
  renderDetail(s);
  renderCards();
}

function closeDetail() {
  g('detail').classList.remove('open');
  openId = null;
  renderCards();
}

function incomeStatementForSite(s, costs = null, plan = currentConstructionPlan()) {
  const metrics = currentUserMetrics();
  const planScenario = plan.key !== 'auto';
  const recastIncome = planScenario || !!costs || metricsCustomized();
  const storedNoi = Math.round(s.noi || 0);
  const opexRatio = metricRate('expenseRatioPct') || 0.35;
  const vacancyRate = metricRate('vacancyPct') || 0.05;
  const baseGrossPotentialRent = Math.round(s.grossPotentialRent || (storedNoi ? storedNoi / Math.max(0.01, (1 - opexRatio) * (1 - vacancyRate)) : 0));
  const grossPotentialRent = Math.round(baseGrossPotentialRent * (1 + (plan.rentPremium || 0)));
  const vacancyLoss = Math.round(recastIncome ? grossPotentialRent * vacancyRate : (s.vacancyLoss ?? grossPotentialRent * vacancyRate));
  const otherIncome = Math.round(s.otherIncome ?? (s.units || 0) * 600);
  const effectiveGrossIncome = Math.round(recastIncome ? grossPotentialRent - vacancyLoss + otherIncome : (s.effectiveGrossIncome || (grossPotentialRent - vacancyLoss + otherIncome)));
  const operatingExpenses = Math.round(recastIncome ? effectiveGrossIncome * opexRatio : (s.operatingExpenses || Math.max(0, effectiveGrossIncome - storedNoi)));
  const noi = Math.round(recastIncome || !storedNoi ? Math.max(0, effectiveGrossIncome - operatingExpenses) : storedNoi);
  const expenseDetail = !recastIncome && s.expenseDetail ? s.expenseDetail : {
    propertyTaxes: operatingExpenses * 0.22,
    insurance: operatingExpenses * 0.08,
    utilities: operatingExpenses * 0.08,
    repairsMaintenance: operatingExpenses * 0.12,
    payrollAdmin: operatingExpenses * 0.16,
    managementFee: operatingExpenses * 0.08,
    marketingTurnover: operatingExpenses * 0.06,
    replacementReserves: operatingExpenses * 0.08,
    otherOperating: operatingExpenses * 0.12,
  };
  const debtBase = costs?.totalCost || s.totalCost || 0;
  const ltc = metricRate('loanToCostPct') || 0.65;
  const interestRate = metricRate('interestRatePct') || 0.065;
  const loanAmount = recastIncome ? debtBase * ltc : (s.loanAmount || debtBase * ltc);
  const debtService = Math.round(recastIncome ? loanAmount * interestRate : (s.debtService ?? loanAmount * interestRate));
  return {
    grossPotentialRent,
    vacancyLoss,
    otherIncome,
    effectiveGrossIncome,
    operatingExpenses,
    expenseDetail,
    noi,
    debtService,
    cfbt: Math.round((planScenario || costs) ? noi - debtService : (s.cfbt ?? (noi - debtService))),
  };
}

function expenseRowsHTML(expenseDetail = {}) {
  const rows = [
    ['Property taxes', expenseDetail.propertyTaxes],
    ['Insurance', expenseDetail.insurance],
    ['Utilities', expenseDetail.utilities],
    ['Repairs & maintenance', expenseDetail.repairsMaintenance],
    ['Payroll / admin', expenseDetail.payrollAdmin],
    ['Management fee', expenseDetail.managementFee],
    ['Marketing / turnover', expenseDetail.marketingTurnover],
    ['Replacement reserves', expenseDetail.replacementReserves],
    ['Other operating', expenseDetail.otherOperating],
  ];
  return rows.map(([label, value]) => `<tr><td>${label}</td><td>${fmtD(value || 0)}</td></tr>`).join('');
}

function baseHardCostPerSf(type) {
  const m = currentUserMetrics();
  const byType = {
    'Multifamily': m.hardCostMultifamily,
    'Mixed-Use': m.hardCostMixedUse,
    'Condo/TH': m.hardCostCondoTH,
    'New House': m.hardCostNewHouse,
  };
  return Number(byType[type]) || FRONTEND_HARD_COST_PSF[type] || 285;
}

function costModelForSite(s, plan = currentConstructionPlan()) {
  const metrics = currentUserMetrics();
  const units = s.units || 0;
  const avgUnitSf = s.usf || 800;
  const totalSF = units * avgUnitSf;
  const land = s.landCost || siteAskPrice(s) || 0;
  const override = currentHardCostOverride();
  const typeBase = baseHardCostPerSf(s.type);
  const defaultTypeBase = FRONTEND_HARD_COST_PSF[s.type] || FRONTEND_HARD_COST_PSF.Multifamily;
  const planDelta = plan.hardCost ? plan.hardCost - defaultTypeBase : 0;
  const basePsf = override || Math.max(100, Math.round(typeBase + planDelta));
  let modeledHard = basePsf * totalSF;
  if (totalSF > 100000) modeledHard *= 0.93;
  else if (totalSF > 50000) modeledHard *= 0.95;
  modeledHard = Math.round(modeledHard);

  const storedHard = Math.round(s.hardCosts || 0);
  const storedHardPsf = totalSF ? Math.round(storedHard / totalSF) : 0;
  const modeledHardPsf = totalSF ? Math.round(modeledHard / totalSF) : 0;
  const shouldRecast = override || plan.key !== 'auto' || metricsCustomized() || !storedHard || storedHardPsf > modeledHardPsf * 1.2;

  const hardCosts = shouldRecast ? modeledHard : storedHard;
  const softPct = Math.max(0, (metrics.baseSoftCostPct / 100) + ((plan.softPct ?? 0.18) - 0.18));
  const softCosts = shouldRecast ? Math.round(hardCosts * softPct) : Math.round(s.softCosts ?? Math.max(0, ((s.totalCost || 0) - land) * 0.24));
  const preCarry = land + hardCosts + softCosts;
  const carryYears = (plan.months || 18) / 12;
  const ltc = metrics.loanToCostPct / 100;
  const interestRate = metrics.interestRatePct / 100;
  const carryCost = shouldRecast ? Math.round(preCarry * ltc * interestRate * carryYears) : Math.round(s.carryCost ?? preCarry * ltc * interestRate * carryYears);
  const totalCost = shouldRecast ? preCarry + carryCost : Math.round(s.totalCost || preCarry + carryCost);

  return {
    land,
    totalSF,
    hardCosts,
    softCosts,
    carryCost,
    totalCost,
    hardPerSf: totalSF ? Math.round(hardCosts / totalSF) : 0,
    hardPerUnit: units ? Math.round(hardCosts / units) : 0,
    totalPerSf: totalSF ? Math.round(totalCost / totalSF) : 0,
    totalPerUnit: units ? Math.round(totalCost / units) : 0,
    basePsf,
    planKey: plan.key,
    planLabel: plan.label,
    planNote: plan.note,
    softPct,
    loanToCost: ltc,
    interestRate,
    months: plan.months || 18,
    rentPremium: plan.rentPremium || 0,
    storedHardPsf,
    recast: !!shouldRecast,
    source: override ? 'custom input' : plan.key !== 'auto' ? plan.label : metricsCustomized() ? 'user settings' : shouldRecast ? 'current base assumption' : 'stored model',
  };
}

function valuationForSite(s, costs = costModelForSite(s), income = incomeStatementForSite(s, costs)) {
  const metrics = currentUserMetrics();
  const entryCap = Number(s.entryCap) || FRONTEND_CAP_RATES[s.hood] || 0.0525;
  const exitCap = entryCap + ((Number(metrics.exitCapSpreadBps) || 0) / 10000);
  const noi = Math.round(income.noi || 0);
  const year5Noi = Math.round(noi * Math.pow(1 + metricRate('rentGrowthPct'), 4));
  const exitValue = exitCap ? Math.round(year5Noi / exitCap) : 0;
  const netProfit = exitValue - costs.totalCost;
  return {
    entryCap,
    exitCap,
    noi,
    year5Noi,
    exitValue,
    netProfit,
    capOnCost: costs.totalCost ? Math.round((noi / costs.totalCost) * 10000) / 100 : 0,
    devSpreadPct: costs.totalCost ? (exitValue - costs.totalCost) / costs.totalCost : 0,
  };
}

function renderDetail(s) {
  const costs = costModelForSite(s);
  const income = incomeStatementForSite(s, costs);
  const valuation = valuationForSite(s, costs, income);
  const irr=s.irrV||0, prof=valuation.netProfit||0, tc=costs.totalCost||0;
  const pc=prof>0?'#1d9e75':'#e24b4a', ic=irrC(irr);
  const spd=Math.round((valuation.devSpreadPct||0)*1000)/10;
  const ask=siteAskPrice(s);
  const land=costs.land||ask||0;
  const listingStatus = siteListingStatus(s);
  const devStatus = developmentStatusLabel(s);
  const offMarket = isOffMarketSite(s);
  const landLabel=offMarket?'Imputed land value':'Asking price';
  const landNote=offMarket?'Estimated from comparable land basis or permit data':'Used as land basis in underwriting';
  const metrics = currentUserMetrics();
  const vacancyLabel = Math.round(metrics.vacancyPct * 10) / 10;
  const totalSF=(s.units||0)*(s.usf||800);
  const hardCostOverride=currentHardCostOverride();
  const hardCosts=costs.hardCosts;
  const softCosts=costs.softCosts;
  const carryCost=costs.carryCost;
  const hardPerSf=costs.hardPerSf;
  const hardPerUnit=costs.hardPerUnit;
  const totalPerSf=costs.totalPerSf;
  const totalPerUnit=costs.totalPerUnit;
  const softPctHard=hardCosts?Math.round((softCosts/hardCosts)*1000)/10:0;
  const hardCostRead = hardPerUnit >= 400000
    ? 'High hard cost per unit is being driven by unit size/count. Compare hard cost per SF first; per-unit cost is only reliable against similar unit sizes.'
    : 'Hard cost per SF is the primary construction benchmark. Per-unit cost is a secondary check and rises quickly for larger units.';
  const bars=[
    [land,'#0f1f3d','Land'+(offMarket?' (imputed)':'')],
    [hardCosts,'#378add','Hard costs'],
    [softCosts,'#1d9e75','Soft costs'],
    [carryCost,'#ef9f27','Financing carry'],
  ].filter(x=>x[0]>0);

  // Load comps async
  setTimeout(async () => {
    const compsEl = g('comps-' + s.id);
    if (!compsEl) return;
    const comps = await loadComps(s);
    if (!comps || comps.comps === 0) {
      compsEl.innerHTML = '<span style="color:#aaa;font-size:10px">No recent sold comps in this submarket</span>';
      return;
    }
    compsEl.innerHTML = `
      <table style="width:100%;font-size:10px;border-collapse:collapse">
        <tr style="color:#aaa"><td>Metric</td><td style="text-align:right">Avg</td><td style="text-align:right">Median</td></tr>
        <tr style="border-top:0.5px solid #f0f0f0"><td>Cap rate</td>
          <td style="text-align:right;font-weight:600">${comps.capRate?.avg ? (comps.capRate.avg*100).toFixed(2)+'%' : '—'}</td>
          <td style="text-align:right">${comps.capRate?.median ? (comps.capRate.median*100).toFixed(2)+'%' : '—'}</td></tr>
        <tr style="border-top:0.5px solid #f0f0f0"><td>Price/unit</td>
          <td style="text-align:right;font-weight:600">${comps.pricePerUnit?.avg ? fmtD(comps.pricePerUnit.avg) : '—'}</td>
          <td style="text-align:right">${comps.pricePerUnit?.median ? fmtD(comps.pricePerUnit.median) : '—'}</td></tr>
        <tr style="border-top:0.5px solid #f0f0f0"><td style="color:#aaa">${comps.comps} comps · last 24 months</td><td></td><td></td></tr>
      </table>
      ${comps.recentComps?.length ? `
      <div style="margin-top:6px;font-size:9px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Recent transactions</div>
      ${comps.recentComps.slice(0,3).map(c => `
        <div style="padding:4px 0;border-bottom:0.5px solid #f5f5f5;font-size:10px">
          <span style="color:#333">${c.saleDate}</span>
          <span style="float:right;font-weight:600">${fmtM(c.salePrice)}</span>
          <span style="color:#aaa;float:right;margin-right:8px">${c.capRate ? (c.capRate*100).toFixed(2)+'% cap' : ''}</span>
        </div>`).join('')}` : ''}`;
  }, 100);

  g('d-body').innerHTML = `
    <div class="ig">
      <div class="ic"><div class="icl">Neighborhood</div><div class="icv">${s.hood}</div></div>
      <div class="ic"><div class="icl">Zoning</div><div class="icv">${s.zone}</div></div>
      <div class="ic"><div class="icl">Listing status</div><div class="icv">${listingStatus}</div></div>
      <div class="ic"><div class="icl">Development status</div><div class="icv">${devStatus}</div></div>
      <div class="ic"><div class="icl">Units / Avg SF</div><div class="icv">${s.units} / ${s.usf} SF</div></div>
      <div class="ic"><div class="icl">${landLabel}</div><div class="icv">${land?fmtD(land):'Not provided'} <span style="display:block;font-size:8px;color:#7f8a9a;font-weight:600;margin-top:1px">${landNote}</span></div></div>
      <div class="ic"><div class="icl">All-in cost</div><div class="icv">${fmtM(tc)}</div></div>
    </div>
    <button class="ab as" onclick="toggleWatch(${s.id}, event)">${isWatched(s.id)?'Remove from watchlist':'Save to watchlist'}</button>
    <div class="sh">Map options</div>
    ${renderMapPanel(s)}
    <div class="sh">Returns</div>
    <div class="mbg">
      <div class="mb" style="border-left-color:${pc}"><div class="mbl">Net profit</div><div class="mbv" style="color:${pc}">${fmtM(prof)}</div><div class="mbs">exit − all-in</div></div>
      <div class="mb" style="border-left-color:${ic}"><div class="mbl">IRR (5-yr)</div><div class="mbv" style="color:${ic}">${Math.round(irr*10)/10}%</div><div class="mbs">${irrL(irr)}</div></div>
      <div class="mb" style="border-left-color:${ic}"><div class="mbl">Cap on cost</div><div class="mbv">${valuation.capOnCost||0}%</div><div class="mbs">vs ${(valuation.entryCap*100).toFixed(2)}% mkt</div></div>
      <div class="mb" style="border-left-color:${ic}"><div class="mbl">Dev spread</div><div class="mbv">${spd}%</div><div class="mbs">${fmtM(prof)} above cost</div></div>
    </div>
    <div class="sh">Cost waterfall</div>
    ${bars.map(([v,c,l])=>`<div class="wfr"><div class="wfl"><span>${l}</span><span>${fmtD(v)}</span></div><div class="wft"><div class="wff" style="width:${Math.round(v/tc*100)}%;background:${c}"></div></div></div>`).join('')}
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-top:1px solid #e8e8e8;margin-top:4px;font-size:11px;font-weight:600"><span>Total all-in</span><span>${fmtD(tc)}</span></div>
    <div class="sh">Why this pencils</div>
    ${pencilReadHTML(s, costs, income, valuation)}
    <div class="sh">Construction budget</div>
    <table class="ct">
      <tr><td>Construction plan</td><td>${costs.planLabel}</td></tr>
      <tr><td>Total building SF</td><td>${totalSF.toLocaleString()} SF</td></tr>
      <tr><td>Hard construction</td><td>${fmtD(hardCosts)}</td></tr>
      <tr><td>Hard cost / SF</td><td>${fmtD(hardPerSf)}/SF${hardCostOverride?' <span style="color:#b98b2f;font-size:9px">custom input</span>':''}</td></tr>
      <tr><td>Hard cost / unit</td><td>${fmtD(hardPerUnit)}/unit</td></tr>
      <tr><td>Soft costs / hard costs</td><td>${softPctHard}%</td></tr>
      <tr><td>Loan / interest assumptions</td><td>${Math.round((costs.loanToCost || 0) * 1000) / 10}% LTC @ ${Math.round((costs.interestRate || 0) * 1000) / 10}%</td></tr>
      <tr><td>Construction period</td><td>${costs.months} months</td></tr>
      <tr><td>Rent impact</td><td>${signedPlanPct(costs.rentPremium)}</td></tr>
      <tr class="tot"><td>Total cost basis</td><td>${fmtD(totalPerSf)}/SF | ${fmtD(totalPerUnit)}/unit</td></tr>
    </table>
    <div style="font-size:9px;color:#6f7b8c;line-height:1.35;margin:5px 0 8px">${costs.planNote} ${hardCostRead}${costs.recast && costs.storedHardPsf ? ' Stored hard cost was about ' + fmtD(costs.storedHardPsf) + '/SF, so this view is recast to ' + fmtD(costs.hardPerSf) + '/SF.' : ''} The Excel Construction Costs tab includes detailed hard and soft cost line items.</div>
    <div class="sh">Plan comparison</div>
    ${scenarioComparisonHTML(s)}
    <div class="sh">Valuation</div>
    <table class="ct">
      <tr><td>NOI (stabilized)</td><td>${fmtD(valuation.noi)}</td></tr>
      <tr><td>Exit cap rate</td><td>${(valuation.exitCap*100).toFixed(2)}%</td></tr>
      <tr><td>Year 5 NOI</td><td>${fmtD(valuation.year5Noi)}</td></tr>
      <tr><td>Exit value</td><td>${fmtD(valuation.exitValue)}</td></tr>
      <tr><td>Valuation formula</td><td>${fmtD(valuation.year5Noi)} / ${(valuation.exitCap*100).toFixed(2)}%</td></tr>
      <tr><td style="color:#e24b4a">Less: all-in cost</td><td style="color:#e24b4a">−${fmtD(tc)}</td></tr>
      <tr class="tot"><td style="color:${pc}">Net profit</td><td style="color:${pc};font-size:14px">${fmtD(prof)}</td></tr>
    </table>
    <div class="sh">Income statement</div>
    <table class="ct">
      <tr><td>Gross potential rent</td><td>${fmtD(income.grossPotentialRent)}</td></tr>
      <tr><td>Vacancy loss (${vacancyLabel}%)</td><td style="color:#e24b4a">-${fmtD(income.vacancyLoss)}</td></tr>
      <tr><td>Other income</td><td>${fmtD(income.otherIncome)}</td></tr>
      <tr class="tot"><td>Effective gross income</td><td>${fmtD(income.effectiveGrossIncome)}</td></tr>
      ${expenseRowsHTML(income.expenseDetail)}
      <tr><td style="color:#e24b4a">Total operating expenses</td><td style="color:#e24b4a">-${fmtD(income.operatingExpenses)}</td></tr>
      <tr class="tot"><td>Net operating income</td><td>${fmtD(income.noi)}</td></tr>
      <tr><td>Debt service</td><td style="color:#e24b4a">-${fmtD(income.debtService)}</td></tr>
      <tr class="tot"><td>Cash flow before tax</td><td>${fmtD(income.cfbt)}</td></tr>
    </table>
    <div class="sh">Sold comps — ${s.hood}</div>
    <div id="comps-${s.id}" style="font-size:10px;color:#aaa">Loading comps...</div>

    <div class="sh">Assumption sources</div>
    ${sourceLinksHTML(s)}

    <div class="sh">AI deal analysis <span style="font-size:8px;color:#bbb;font-weight:400">powered by Claude</span></div>
    <div id="narr-${s.id}"><button class="gb" onclick="generateNarrative(${s.id})">Generate analysis →</button></div>
    <button class="ab as" onclick="shareDeal()">⤴ Copy share link</button>
    <button class="ab as" onclick="exportExcel(${s.id})">Download Excel workbook</button>
    <button class="ab ap" onclick="exportPDF(${s.id})">↓ Download PDF deal memo</button>`;
}

async function loadComps(siteOrHood) {
  try {
    const hood = typeof siteOrHood === 'object' ? siteOrHood.hood : siteOrHood;
    const qs = typeof siteOrHood === 'object' ? compQueryForSite(siteOrHood, 6) : '';
    const r = await fetch(API + '/api/comps/submarket/' + encodeURIComponent(hood) + qs);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

async function generateNarrative(id) {
  const el = g('narr-'+id);
  if (!el) return;
  el.innerHTML = '<div style="font-size:11px;color:#aaa;padding:6px">Generating analysis...</div>';
  try {
    const r = await fetch(API+'/api/narrative/'+id, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({overrides:{}})
    });
    if (!r.ok) throw new Error('API '+r.status);
    const data = await r.json();
    el.innerHTML = '<div class="nb">'+data.narrative+'</div>';
  } catch(e) {
    el.innerHTML = '<div style="font-size:11px;color:#e24b4a">Could not generate — '+e.message+'</div>';
  }
}

function shareDeal() {
  if (!openId) return;
  const url = window.location.origin+'?site='+openId;
  if (navigator.clipboard) navigator.clipboard.writeText(url);
  alert('Link copied!\n'+url);
}

function safeFileName(value) {
  return String(value || 'ParceLLA_Report').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0,80);
}

function xmlEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xlsCell(value, type = 'String', style = '') {
  if (Array.isArray(value)) {
    [value, type = 'String', style = ''] = value;
  }
  const empty = value === undefined || value === null || value === '';
  const numeric = type === 'Number' && !empty && isFinite(Number(value));
  const dataType = numeric ? 'Number' : 'String';
  const data = numeric ? String(Number(value)) : xmlEscape(empty ? '' : value);
  const styleId = style || (numeric ? 'num' : 'body');
  return '<Cell ss:StyleID="' + styleId + '"><Data ss:Type="' + dataType + '">' + data + '</Data></Cell>';
}

function xlsRow(values = [], style = '') {
  return '<Row>' + values.map(v => {
    if (Array.isArray(v)) return xlsCell(v[0], v[1], v[2] || style);
    return xlsCell(v, 'String', style);
  }).join('') + '</Row>';
}

function xlsTitleRow(title, subtitle = '') {
  return xlsRow([title, subtitle], 'title');
}

function xlsSectionRow(title) {
  return xlsRow([title], 'section');
}

function xlsHeaderRow(values = []) {
  return xlsRow(values, 'header');
}

function cellNumber(value) {
  return value === undefined || value === null || value === '' ? '' : [value, 'Number', 'num'];
}

function cellMoney(value) {
  return value === undefined || value === null || value === '' ? '' : [value, 'Number', 'money'];
}

function cellMoneyRed(value) {
  return value === undefined || value === null || value === '' ? '' : [value, 'Number', 'moneyRed'];
}

function cellMoneySigned(value) {
  return Number(value) < 0 ? cellMoneyRed(value) : cellMoney(value);
}

function cellPct(value) {
  return value === undefined || value === null || value === '' ? '' : [Number(value) / 100, 'Number', 'pctNum'];
}

function xlsStyles() {
  return '<Styles>' +
    '<Style ss:ID="body"><Alignment ss:Vertical="Top"/><Font ss:FontName="Calibri" ss:Size="11"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E8E8E8"/></Borders></Style>' +
    '<Style ss:ID="title"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F1F3D" ss:Pattern="Solid"/></Style>' +
    '<Style ss:ID="section"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#0F1F3D"/><Interior ss:Color="#F3F6FA" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#C9D3E2"/></Borders></Style>' +
    '<Style ss:ID="header"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1A3560" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0F1F3D"/></Borders></Style>' +
    '<Style ss:ID="num"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><Font ss:FontName="Calibri" ss:Size="11"/><NumberFormat ss:Format="#,##0.0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E8E8E8"/></Borders></Style>' +
    '<Style ss:ID="money"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><Font ss:FontName="Calibri" ss:Size="11"/><NumberFormat ss:Format="$#,##0;[Red]($#,##0);-"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E8E8E8"/></Borders></Style>' +
    '<Style ss:ID="moneyRed"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><Font ss:FontName="Calibri" ss:Size="11" ss:Color="#E24B4A"/><NumberFormat ss:Format="$#,##0;[Red]($#,##0);-"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E8E8E8"/></Borders></Style>' +
    '<Style ss:ID="pctNum"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><Font ss:FontName="Calibri" ss:Size="11"/><NumberFormat ss:Format="0.0%"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E8E8E8"/></Borders></Style>' +
    '<Style ss:ID="note"><Alignment ss:WrapText="1" ss:Vertical="Top"/><Font ss:FontName="Calibri" ss:Size="10" ss:Color="#666666"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#EEEEEE"/></Borders></Style>' +
    '</Styles>';
}

function xlsSheet(name, rows, widths = []) {
  const defaultWidths = widths.length ? widths : [180, 120, 110, 110, 120, 180, 180, 120, 120, 120, 160, 160, 140, 140];
  const cols = defaultWidths.map(w => '<Column ss:Width="' + w + '"/>').join('');
  return '<Worksheet ss:Name="' + xmlEscape(name).slice(0,31) + '"><Table>' + cols + rows.join('') + '</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet>';
}

function downloadTextFile(filename, content, type = 'application/vnd.ms-excel;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function fetchJSON(path) {
  const r = await fetch(API + path);
  if (!r.ok) return null;
  return await r.json();
}

function compQueryForSite(s, limit = 12) {
  const p = new URLSearchParams({ limit: String(limit) });
  p.set('recencyDays', '365');
  if (s?.lat && s?.lng) {
    p.set('siteLat', s.lat);
    p.set('siteLng', s.lng);
  }
  const q = p.toString();
  return q ? '?' + q : '';
}

function mapOptionsRows(s) {
  const rows = [
    xlsTitleRow('Mapping & Location Research', s.addr),
    xlsHeaderRow(['Option', 'Why it matters', 'Link']),
    xlsRow(['Google Maps', 'Open the parcel location and surrounding neighborhood', mapsLink(s.addr)]),
    xlsRow(['Directions', 'Check access from target origin points', directionsLink(s.addr)]),
    xlsRow(['Street View', 'Review frontage, curb cuts, slope, street condition and adjacent uses', streetViewLink(s.addr)]),
    xlsRow(['Satellite / aerial', 'Review building footprint, lot layout, alleys and neighboring improvements', mapsLink(s.addr)]),
    xlsRow(['ZIMAS zoning search', 'Validate zoning, overlays, specific plans, TOC and planning notes', officialResearchLink(s.addr, 'ZIMAS zoning')]),
    xlsRow(['LADBS permit search', 'Review permits, plan checks, certificates and permit history', officialResearchLink(s.addr, 'LADBS permits PCIS')]),
    xlsRow(['Rent comps nearby', 'Quick map search for visible rental competition', nearbySearchLink(s.addr, 'apartments for rent')]),
    xlsRow(['Sales comps nearby', 'Quick map search for nearby multifamily sales context', nearbySearchLink(s.addr, 'multifamily sale comps')]),
  ];
  return rows;
}

function investmentReadRows(s, costs, income, valuation) {
  return [
    xlsTitleRow('Investment Read', s.addr),
    xlsHeaderRow(['Status', 'Read']),
    ...pencilReadItems(s, costs, income, valuation).map(item => xlsRow([item.status, [item.text, 'String', item.status === 'Risk' ? 'note' : '']])),
    xlsRow(['']),
    xlsSectionRow('Data Sources'),
    xlsRow(['LA City Open Data', 'https://data.lacity.org/']),
    xlsRow(['ZIMAS zoning', officialResearchLink(s.addr, 'ZIMAS zoning')]),
    xlsRow(['LADBS permits', officialResearchLink(s.addr, 'LADBS permits PCIS')]),
    xlsRow(['Google Maps', mapsLink(s.addr)]),
    xlsRow(['County recorder search', officialResearchLink(s.addr, 'Los Angeles county recorder deed sale')]),
  ];
}

function scenarioRowsForExport(s) {
  return [
    xlsTitleRow('Construction Plan Scenarios', s.addr),
    xlsHeaderRow(['Plan', 'Hard Cost / SF', 'Soft %', 'Months', 'Rent Impact', 'Total Cost', 'Cost / Unit', 'NOI', 'Exit Value', 'Net Profit', 'Cap on Cost', 'Notes']),
    ...scenarioListForSite(s).map(row => xlsRow([
      row.plan.label,
      cellMoney(row.costs.hardPerSf),
      cellPct(Math.round((row.costs.softPct || 0) * 1000) / 10),
      cellNumber(row.costs.months || 18),
      cellPct(Math.round((row.costs.rentPremium || 0) * 1000) / 10),
      cellMoney(row.costs.totalCost),
      cellMoney(row.costs.totalPerUnit),
      cellMoney(row.income.noi),
      cellMoney(row.valuation.exitValue),
      cellMoneySigned(row.valuation.netProfit),
      cellPct(row.valuation.capOnCost || 0),
      [row.plan.note || '', 'String', 'note'],
    ])),
  ];
}


function fmtCompDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

function rentRowsFromSubmarket(s, submarket) {
  const rents = submarket?.rents || {};
  const unitMix = [
    ['Studio', s.ms ?? 0.25, rents.studio],
    ['1 BR', s.mo ?? 0.50, rents.one],
    ['2 BR', s.mt ?? 0.20, rents.two],
    ['3 BR', s.mth ?? 0.05, rents.three],
  ];
  const units = s.units || 0;
  const rows = [
    xlsHeaderRow(['Unit Type', 'Mix %', 'Units', 'Rent / Month', 'Monthly Rent', 'Annual Rent']),
  ];
  unitMix.forEach(([label, mix, rent]) => {
    const unitCount = Math.round(units * mix * 10) / 10;
    const monthly = Math.round(unitCount * (rent || 0));
    rows.push(xlsRow([label, cellPct(Math.round(mix * 1000) / 10), cellNumber(unitCount), cellMoney(rent || 0), cellMoney(monthly), cellMoney(monthly * 12)]));
  });
  const blended = unitMix.reduce((sum, [, mix, rent]) => sum + mix * (rent || 0), 0);
  rows.push(xlsRow(['']));
  rows.push(xlsRow(['Blended Rent', '', '', cellMoney(Math.round(blended)), cellMoney(Math.round(blended * units)), cellMoney(Math.round(blended * units * 12))], 'section'));
  return rows;
}

function rentCompPropertyRows(rentComps, s, submarket) {
  const rows = [
    xlsTitleRow('Rent Comps', s.addr),
  ];
  if (rentComps?.source || rentComps?.matchLabel || rentComps?.message || rentComps?.limiter) {
    rows.push(xlsRow(['Comp Source', rentComps?.source || '', rentComps?.matchLabel || '']));
    rows.push(xlsRow(['Recency Window', rentComps?.recencyDays ? String(rentComps.recencyDays) + ' days' : '365 days', rentComps?.staleSavedPropertyCount ? String(rentComps.staleSavedPropertyCount) + ' older saved comp(s) hidden' : '']));
    if (rentComps?.limiter) rows.push(xlsRow(['Limiter', [rentComps.limiter, 'String', 'note']]));
    rows.push(xlsRow(['']));
  }
  rows.push(xlsHeaderRow(['Property / Address', 'Distance mi', 'Unit Type', 'Beds', 'Baths', 'Monthly Rent', 'Unit SF', 'Rent / SF', 'Year Built', 'Property Units', 'Amenities / Notes', 'Source', 'Period / Listed', 'URL']));

  const list = rentComps?.recentComps || [];
  if (list.length) {
    list.forEach(c => rows.push(xlsRow([
      c.propertyName ? c.propertyName + ' - ' + (c.address || '') : c.address || '',
      cellNumber(c.distanceMiles),
      c.bedroomType || '',
      cellNumber(c.bedrooms),
      cellNumber(c.bathrooms),
      cellMoney(c.monthlyRent),
      cellNumber(c.unitSf),
      cellMoney(c.rentPerSf),
      cellNumber(c.yearBuilt),
      cellNumber(c.propertyUnits),
      [c.amenities || '', 'String', 'note'],
      c.source || '',
      fmtCompDate(c.period),
      c.url || '',
    ])));
  } else {
    rows.push(xlsRow([rentComps?.message || 'No property-level rent comps returned. Market rent benchmarks are shown below.'], 'note'));
  }

  rows.push(xlsRow(['']));
  rows.push(xlsSectionRow('Market Rent Benchmark'));
  rows.push(...rentRowsFromSubmarket(s, submarket));

  const benchmarkRows = rentComps?.benchmarkRows || [];
  if (benchmarkRows.length) {
    rows.push(xlsRow(['']));
    rows.push(xlsSectionRow('Saved Rent Benchmark Rows'));
    rows.push(xlsHeaderRow(['Bedroom Type', 'Monthly Rent', 'Source', 'Period']));
    benchmarkRows.forEach(c => rows.push(xlsRow([c.bedroomType || '', cellMoney(c.monthlyRent), c.source || '', fmtCompDate(c.period)])));
  }
  return rows;
}

function incomeStatementRows(s, income = incomeStatementForSite(s)) {
  const e = income.expenseDetail || {};
  const rows = [
    xlsTitleRow('Income Statement', s.addr),
    xlsHeaderRow(['Line Item', 'Annual Amount', '$ / Unit', '% of EGI', 'Notes']),
    xlsRow(['Gross Potential Rent', cellMoney(income.grossPotentialRent), s.units ? cellMoney(Math.round(income.grossPotentialRent / s.units)) : '', '', 'Scheduled market rent before vacancy']),
    xlsRow(['Vacancy Loss', cellMoneyRed(income.vacancyLoss), s.units ? cellMoneyRed(Math.round(income.vacancyLoss / s.units)) : '', income.grossPotentialRent ? cellPct(Math.round((income.vacancyLoss / income.grossPotentialRent) * 1000) / 10) : '', 'Modeled vacancy and credit loss']),
    xlsRow(['Other Income', cellMoney(income.otherIncome), s.units ? cellMoney(Math.round(income.otherIncome / s.units)) : '', '', 'Parking, laundry, storage, fees and other ancillary income']),
    xlsRow(['Effective Gross Income', cellMoney(income.effectiveGrossIncome), s.units ? cellMoney(Math.round(income.effectiveGrossIncome / s.units)) : '', cellPct(100), 'Gross rent less vacancy plus other income'], 'section'),
    xlsRow(['Property Taxes', cellMoneyRed(e.propertyTaxes || 0), s.units ? cellMoneyRed(Math.round((e.propertyTaxes || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.propertyTaxes || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Operating expense allocation']),
    xlsRow(['Insurance', cellMoneyRed(e.insurance || 0), s.units ? cellMoneyRed(Math.round((e.insurance || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.insurance || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Operating expense allocation']),
    xlsRow(['Utilities', cellMoneyRed(e.utilities || 0), s.units ? cellMoneyRed(Math.round((e.utilities || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.utilities || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Common utilities and reimbursable leakage']),
    xlsRow(['Repairs & Maintenance', cellMoneyRed(e.repairsMaintenance || 0), s.units ? cellMoneyRed(Math.round((e.repairsMaintenance || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.repairsMaintenance || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Stabilized maintenance allowance']),
    xlsRow(['Payroll / Admin', cellMoneyRed(e.payrollAdmin || 0), s.units ? cellMoneyRed(Math.round((e.payrollAdmin || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.payrollAdmin || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Onsite/admin expense allocation']),
    xlsRow(['Management Fee', cellMoneyRed(e.managementFee || 0), s.units ? cellMoneyRed(Math.round((e.managementFee || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.managementFee || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Third-party management allowance']),
    xlsRow(['Marketing / Turnover', cellMoneyRed(e.marketingTurnover || 0), s.units ? cellMoneyRed(Math.round((e.marketingTurnover || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.marketingTurnover || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Leasing, turns and concessions']),
    xlsRow(['Replacement Reserves', cellMoneyRed(e.replacementReserves || 0), s.units ? cellMoneyRed(Math.round((e.replacementReserves || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.replacementReserves || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Capital reserve allowance']),
    xlsRow(['Other Operating', cellMoneyRed(e.otherOperating || 0), s.units ? cellMoneyRed(Math.round((e.otherOperating || 0) / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round(((e.otherOperating || 0) / income.effectiveGrossIncome) * 1000) / 10) : '', 'Remaining operating expense allocation']),
    xlsRow(['Total Operating Expenses', cellMoneyRed(income.operatingExpenses), s.units ? cellMoneyRed(Math.round(income.operatingExpenses / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round((income.operatingExpenses / income.effectiveGrossIncome) * 1000) / 10) : '', 'Total opex ratio'], 'section'),
    xlsRow(['Net Operating Income', cellMoney(income.noi), s.units ? cellMoney(Math.round(income.noi / s.units)) : '', income.effectiveGrossIncome ? cellPct(Math.round((income.noi / income.effectiveGrossIncome) * 1000) / 10) : '', 'NOI before debt service'], 'section'),
    xlsRow(['Debt Service', cellMoneyRed(income.debtService), s.units ? cellMoneyRed(Math.round(income.debtService / s.units)) : '', '', 'Interest-only debt service assumption']),
    xlsRow(['Cash Flow Before Tax', income.cfbt >= 0 ? cellMoney(income.cfbt) : cellMoneyRed(Math.abs(income.cfbt)), s.units ? (income.cfbt >= 0 ? cellMoney(Math.round(income.cfbt / s.units)) : cellMoneyRed(Math.abs(Math.round(income.cfbt / s.units)))) : '', '', 'NOI less debt service'], 'section'),
  ];
  return rows;
}

function salesCompRows(comps) {
  const rows = [
    xlsTitleRow('Sales Comps', comps?.hood || ''),
  ];
  if (comps?.matchLabel) {
    rows.push(xlsRow(['Match Used', comps.matchLabel, comps.message || ''], comps?.fallback ? 'note' : ''));
    rows.push(xlsRow(['']));
  }
  rows.push(xlsHeaderRow(['Address', 'Distance mi', 'Neighborhood', 'Sale Date', 'Sale Price', 'Price Method', 'Confidence', 'Units', 'Avg Unit SF', 'Year Built', 'Cap Rate %', 'Price / Unit', 'Price / SF', 'NOI', 'Project Type', 'Buyer', 'Seller', 'Source', 'APN', 'Recorder Doc #', 'Transfer Tax', 'Amenities / Notes']));
  const list = comps?.recentComps || [];
  if (!list.length) {
    rows.push(xlsRow(['No recent sold comps returned for this submarket'], 'note'));
  } else {
    list.forEach(c => rows.push(xlsRow([
      c.address || '',
      cellNumber(c.distanceMiles),
      c.neighborhood || '',
      fmtCompDate(c.saleDate),
      cellMoney(c.salePrice),
      c.salePriceMethod || '',
      c.priceConfidence || '',
      cellNumber(c.units),
      cellNumber(c.avgUnitSf),
      cellNumber(c.yearBuilt),
      c.capRate ? cellPct(Math.round(c.capRate * 10000) / 100) : '',
      cellMoney(c.pricePerUnit),
      cellMoney(c.pricePerSf),
      cellMoney(c.noi),
      c.projectType || '',
      c.buyer || '',
      c.seller || '',
      c.source || '',
      c.apn || '',
      c.recorderDocumentNumber || '',
      cellMoney(c.transferTax),
      [c.amenities || c.notes || '', 'String', 'note'],
    ])));
  }
  rows.push(xlsRow(['']));
  rows.push(xlsSectionRow('Summary'));
  rows.push(xlsRow(['Comps Count', cellNumber(comps?.comps || 0)]));
  rows.push(xlsRow(['Avg Cap Rate %', comps?.capRate?.avg ? cellPct(Math.round(comps.capRate.avg * 10000) / 100) : '']));
  rows.push(xlsRow(['Median Cap Rate %', comps?.capRate?.median ? cellPct(Math.round(comps.capRate.median * 10000) / 100) : '']));
  rows.push(xlsRow(['Avg Price / Unit', comps?.pricePerUnit?.avg ? cellMoney(comps.pricePerUnit.avg) : '']));
  rows.push(xlsRow(['Median Price / Unit', comps?.pricePerUnit?.median ? cellMoney(comps.pricePerUnit.median) : '']));
  rows.push(xlsRow(['Avg Price / SF', comps?.pricePerSf?.avg ? cellMoney(comps.pricePerSf.avg) : '']));
  return rows;
}

function costPct(amount, total) {
  return total ? Math.round((amount / total) * 1000) / 10 : 0;
}

function costPerSf(amount, totalSF) {
  return totalSF ? Math.round(amount / totalSF) : 0;
}

function costPerUnit(amount, units) {
  return units ? Math.round(amount / units) : 0;
}

function allocateCostSchedule(total, items) {
  const active = items.filter(item => item.weight > 0);
  const weightTotal = active.reduce((sum, item) => sum + item.weight, 0) || 1;
  let used = 0;
  return active.map((item, index) => {
    const amount = index === active.length - 1
      ? Math.max(0, Math.round(total - used))
      : Math.round(total * item.weight / weightTotal);
    used += amount;
    return { ...item, amount, pct: costPct(amount, total) };
  });
}

function hardCostLineItems(s) {
  const units = s.units || 0;
  const mixedUse = s.type === 'Mixed-Use';
  const condo = s.type === 'Condo/TH';
  return [
    { name: 'Sitework / demolition', weight: s.demo ? 5 : 3, note: s.demo ? 'Demo, clearing, haul-off, erosion control' : 'Site prep, grading, utility potholing' },
    { name: 'Foundation / concrete', weight: 8, note: 'Footings, slab, podium/concrete allowances' },
    { name: 'Framing / structure', weight: condo ? 14 : 13, note: 'Wood/steel framing, sheathing, structural hardware' },
    { name: 'Exterior envelope', weight: 7, note: 'Stucco/siding, waterproofing, facade assemblies' },
    { name: 'Roofing / waterproofing', weight: 3, note: 'Roof membrane, drainage, flashing' },
    { name: 'Windows / exterior doors', weight: 4, note: 'Windows, storefront if applicable, exterior doors' },
    { name: 'Plumbing', weight: 8, note: 'Rough plumbing, fixtures, water heaters, sewer tie-in' },
    { name: 'Electrical', weight: 8, note: 'Service, panels, rough electrical, lighting, low voltage' },
    { name: 'HVAC', weight: 7, note: 'Heating/cooling systems, ducting or mini-splits, ventilation' },
    { name: 'Fire / life safety', weight: units >= 5 ? 3 : 1, note: 'Sprinklers, alarms, emergency lighting, code systems' },
    { name: 'Elevator / vertical transport', weight: units >= 20 ? 4 : 0, note: 'Elevator allowance for larger multifamily projects' },
    { name: 'Insulation / drywall', weight: 6, note: 'Batt/rigid insulation, drywall, taping, acoustic treatment' },
    { name: 'Interior finishes', weight: 12, note: 'Flooring, paint, tile, counters, unit finishes' },
    { name: 'Cabinets / appliances', weight: 4, note: 'Kitchen/bath cabinets and appliance packages' },
    { name: 'Common areas / amenities', weight: units >= 10 ? 3 : 1, note: 'Lobby, corridors, mail, trash, amenity spaces' },
    { name: 'Commercial shell / TI allowance', weight: mixedUse ? 4 : 0, note: 'Ground-floor retail or commercial shell allowance' },
    { name: 'Landscaping / site improvements', weight: 3, note: 'Hardscape, planting, fencing, lighting, parking' },
    { name: 'GC general conditions / OH&P', weight: 7, note: 'Supervision, temporary facilities, insurance, contractor OH/profit' },
    { name: 'Hard-cost contingency', weight: 5, note: 'Design development and construction contingency' },
  ];
}

function softCostLineItems() {
  return [
    { name: 'Architecture / design', weight: 13, note: 'Architectural design, drawings, entitlement support' },
    { name: 'Engineering consultants', weight: 8, note: 'Structural, MEP, civil, soils, survey consultants' },
    { name: 'Permits / plan check', weight: 9, note: 'LADBS plan check, permits, inspection fees' },
    { name: 'Impact / school / utility fees', weight: 10, note: 'School fees, utility connection, sewer/water fees' },
    { name: 'Legal / title / escrow', weight: 5, note: 'Closing, title, legal, entity, transaction counsel' },
    { name: 'Insurance / bonds', weight: 4, note: 'Builder risk, GL, bonds and other project insurance' },
    { name: 'Taxes during construction', weight: 7, note: 'Property taxes and assessments during hold period' },
    { name: 'Construction management', weight: 8, note: 'Owner rep, PM, inspections, third-party reports' },
    { name: 'Lender / appraisal / third party', weight: 5, note: 'Appraisal, environmental, lender diligence, closing fees' },
    { name: 'Developer fee', weight: 15, note: 'Sponsor/developer fee allowance' },
    { name: 'Marketing / lease-up', weight: 5, note: 'Pre-leasing, signage, photography, concessions allowance' },
    { name: 'Soft-cost contingency', weight: 11, note: 'Soft cost contingency and unallocated reserves' },
  ];
}

function carryCostLineItems() {
  return [
    { name: 'Construction interest reserve', weight: 55, note: 'Interest reserve during construction and stabilization' },
    { name: 'Loan origination / exit fees', weight: 15, note: 'Origination, extension, exit and admin fees' },
    { name: 'Property tax carry', weight: 15, note: 'Taxes not already carried in soft costs' },
    { name: 'Operating / lease-up carry', weight: 10, note: 'Pre-stabilization operating shortfall' },
    { name: 'Financing contingency', weight: 5, note: 'Rate, timing and draw schedule contingency' },
  ];
}

function pushCostSchedule(rows, title, total, schedule, totalSF, units) {
  rows.push(xlsRow(['']));
  rows.push(xlsSectionRow(title));
  rows.push(xlsHeaderRow(['Line Item', '%', 'Cost', '$ / SF', '$ / Unit', 'Validation / Notes']));
  schedule.forEach(item => rows.push(xlsRow([
    item.name,
    cellPct(item.pct),
    cellMoney(item.amount),
    totalSF ? cellMoney(costPerSf(item.amount, totalSF)) : '',
    units ? cellMoney(costPerUnit(item.amount, units)) : '',
    [item.note || '', 'String', 'note'],
  ])));
  rows.push(xlsRow([title + ' Total', cellPct(100), cellMoney(total), totalSF ? cellMoney(costPerSf(total, totalSF)) : '', units ? cellMoney(costPerUnit(total, units)) : '', 'Subtotal'], 'section'));
}

function constructionCostRows(s, tc, land) {
  const costs = costModelForSite(s);
  const metrics = currentUserMetrics();
  const units = s.units || 0;
  const avgUnitSf = s.usf || 800;
  const totalSF = costs.totalSF || units * avgUnitSf;
  const landBasis = costs.land || land || 0;
  const totalCost = costs.totalCost || tc || 0;
  const hardCosts = costs.hardCosts || 0;
  const softCosts = costs.softCosts || 0;
  const carryCost = costs.carryCost || 0;
  const loan = Math.round(totalCost * (metrics.loanToCostPct / 100));
  const equity = Math.round(totalCost - loan);
  const hardPerSf = costPerSf(hardCosts, totalSF);
  const hardPerUnit = costPerUnit(hardCosts, units);
  const softPerSf = costPerSf(softCosts, totalSF);
  const softPerUnit = costPerUnit(softCosts, units);
  const carryPerSf = costPerSf(carryCost, totalSF);
  const carryPerUnit = costPerUnit(carryCost, units);
  const totalPerSf = costPerSf(totalCost, totalSF);
  const totalPerUnit = costPerUnit(totalCost, units);
  const softPctHard = hardCosts ? Math.round((softCosts / hardCosts) * 1000) / 10 : 0;
  const hardSchedule = allocateCostSchedule(hardCosts, hardCostLineItems(s));
  const softSchedule = allocateCostSchedule(softCosts, softCostLineItems());
  const carrySchedule = allocateCostSchedule(carryCost, carryCostLineItems());
  const rows = [
    xlsTitleRow('Construction Cost Validation', s.addr),
    xlsRow(['Project Type', s.type || '']),
    xlsRow(['Construction Plan', costs.planLabel]),
    xlsRow(['Plan Notes', [costs.planNote || '', 'String', 'note']]),
    xlsRow(['Hard Cost Basis', cellMoney(costs.hardPerSf), '$ / SF', '', '', costs.source || 'current assumption']),
    xlsRow(['Soft Cost % of Hard Cost', cellPct(Math.round((costs.softPct || 0) * 1000) / 10), '', '', '', 'Soft costs generated from selected plan']),
    xlsRow(['Construction Period', cellNumber(costs.months || 18), 'months', '', '', 'Used to size financing carry']),
    xlsRow(['Rent Premium / Haircut', cellPct(Math.round((costs.rentPremium || 0) * 1000) / 10), '', '', '', 'Used in income statement and exit valuation']),
    xlsRow(['Units', cellNumber(units)]),
    xlsRow(['Avg Unit SF', cellNumber(avgUnitSf)]),
    xlsRow(['Total Net Rentable SF', cellNumber(totalSF)]),
    xlsRow(['Cost Note', ['Line items are an underwriting allocation of the current plan budget, not a contractor bid. Replace with GC pricing when available.' + (currentHardCostOverride() ? ' User hard-cost override applied across all deals: $' + currentHardCostOverride().toLocaleString() + '/SF.' : ''), 'String', 'note']]),
    xlsRow(['']),
    xlsHeaderRow(['Budget Category', 'Cost', '$ / SF', '$ / Unit', '% of Total Cost', 'Validation / Source']),
    xlsRow([isOffMarketSite(s) ? 'Imputed Land Value' : 'Asking Price / Land Basis', cellMoney(Math.round(landBasis)), totalSF ? cellMoney(costPerSf(landBasis, totalSF)) : '', units ? cellMoney(costPerUnit(landBasis, units)) : '', totalCost ? cellPct(costPct(landBasis, totalCost)) : '', isOffMarketSite(s) ? 'Estimated off-market / not-for-sale land basis' : 'For-sale asking price used as land basis']),
    xlsRow(['Hard Costs', cellMoney(hardCosts), cellMoney(hardPerSf), cellMoney(hardPerUnit), totalCost ? cellPct(costPct(hardCosts, totalCost)) : '', 'Detailed schedule below: HVAC, framing, plumbing, electrical, etc.']),
    xlsRow(['Soft Costs', cellMoney(softCosts), totalSF ? cellMoney(softPerSf) : '', units ? cellMoney(softPerUnit) : '', totalCost ? cellPct(costPct(softCosts, totalCost)) : '', 'A&E, permits, fees, legal, developer fee, contingency']),
    xlsRow(['Financing Carry', cellMoney(carryCost), totalSF ? cellMoney(carryPerSf) : '', units ? cellMoney(carryPerUnit) : '', totalCost ? cellPct(costPct(carryCost, totalCost)) : '', 'Interest reserve, loan fees, taxes and lease-up carry']),
    xlsRow(['Total All-In Cost', cellMoney(Math.round(totalCost)), cellMoney(totalPerSf), cellMoney(totalPerUnit), cellPct(100), 'Total underwriting basis'], 'section'),
  ];

  pushCostSchedule(rows, 'Hard Cost Schedule', hardCosts, hardSchedule, totalSF, units);
  pushCostSchedule(rows, 'Soft Cost Schedule', softCosts, softSchedule, totalSF, units);
  pushCostSchedule(rows, 'Financing / Carry Schedule', carryCost, carrySchedule, totalSF, units);

  rows.push(xlsRow(['']));
  rows.push(xlsSectionRow('Financing Metrics'));
  rows.push(xlsRow(['Construction Loan', cellMoney(loan), totalSF ? cellMoney(costPerSf(loan, totalSF)) : '', units ? cellMoney(costPerUnit(loan, units)) : '', totalCost ? cellPct(costPct(loan, totalCost)) : '', 'Uses current user setting: ' + metrics.loanToCostPct + '% loan-to-cost']));
  rows.push(xlsRow(['Equity Required', cellMoney(equity), totalSF ? cellMoney(costPerSf(equity, totalSF)) : '', units ? cellMoney(costPerUnit(equity, units)) : '', totalCost ? cellPct(costPct(equity, totalCost)) : '', 'Borrower cash / sponsor equity']));
  rows.push(xlsRow(['']));
  rows.push(xlsSectionRow('Benchmark Checks'));
  rows.push(xlsRow(['Hard Cost / SF', cellMoney(hardPerSf), '', '', '', 'Primary construction-cost reasonableness check']));
  rows.push(xlsRow(['Hard Cost / Unit', cellMoney(hardPerUnit), '', '', '', hardPerUnit >= 400000 ? 'High because this deal has large units or few units; compare $/SF first.' : 'Useful only when comparing similar unit sizes']));
  rows.push(xlsRow(['Soft Cost / SF', cellMoney(softPerSf), '', '', '', 'Soft-cost basis check']));
  rows.push(xlsRow(['Soft Costs / Hard Costs %', cellPct(softPctHard), '', '', '', 'Soft costs commonly underwritten as a % of hard costs']));
  rows.push(xlsRow(['Total Cost / SF', cellMoney(totalPerSf), '', '', '', 'All-in basis including land, soft costs, carry']));
  rows.push(xlsRow(['Total Cost / Unit', cellMoney(totalPerUnit), '', '', '', 'All-in basis per delivered unit']));
  return rows;
}

function pencilCheckRows(s, m) {
  const gap = Math.max(0, m.tc - m.exitValue);
  const breakevenLand = Math.max(0, m.land + m.netProfit);
  const requiredLandDiscount = Math.max(0, m.land - breakevenLand);
  const requiredNoi = m.exitCap ? m.tc * m.exitCap : 0;
  const noiGap = Math.max(0, requiredNoi - m.noi);
  const noiIncreasePct = m.noi ? Math.round((noiGap / m.noi) * 1000) / 10 : 0;
  const hardCost10Impact = Math.round(m.hardCosts * 0.10);
  const profitAfter10CostCut = Math.round(m.netProfit + hardCost10Impact);
  return [
    xlsTitleRow('Pencil Check', s.addr),
    xlsHeaderRow(['Question', 'Answer', 'Metric', 'Read']),
    xlsRow(['Does it pencil?', m.netProfit >= 0 ? 'Yes' : 'No', cellMoneySigned(Math.round(m.netProfit)), m.netProfit >= 0 ? 'Positive net profit' : 'Net loss / value gap'], m.netProfit >= 0 ? '' : 'note'),
    xlsRow(['Gap to breakeven', gap ? 'Needs improvement' : 'No gap', cellMoney(gap), 'Amount by which all-in cost exceeds exit value']),
    xlsRow(['Breakeven land basis', '', cellMoney(breakevenLand), 'Approximate max land basis if all else stays constant']),
    xlsRow(['Required land discount', '', cellMoney(requiredLandDiscount), 'Land price reduction needed to reach breakeven']),
    xlsRow(['Current hard cost / SF', '', cellMoney(m.hardPerSf), 'Construction-cost reasonableness check']),
    xlsRow(['Current total cost / SF', '', cellMoney(m.totalPerSf), 'All-in basis including land, soft costs, carry']),
    xlsRow(['Current total cost / unit', '', cellMoney(m.totalPerUnit), 'All-in delivered unit basis']),
    xlsRow(['NOI required at exit cap', '', cellMoney(Math.round(requiredNoi)), 'NOI needed for exit value to equal all-in cost']),
    xlsRow(['NOI gap', '', cellMoney(noiGap), 'Required NOI increase to breakeven']),
    xlsRow(['Implied NOI / rent increase', '', cellPct(noiIncreasePct), 'Approximate rent lift needed if expense ratio holds']),
    xlsRow(['If hard costs drop 10%', '', cellMoneySigned(profitAfter10CostCut), 'Estimated net profit after a 10% hard-cost reduction']),
  ];
}


async function exportExcel(id) {
  const s = allSites.find(x => x.id === id);
  if (!s) return;

  const compQuery = compQueryForSite(s, 12);
  const [submarket, comps, rentComps] = await Promise.all([
    fetchJSON('/api/submarkets/' + encodeURIComponent(s.hood)),
    fetchJSON('/api/comps/submarket/' + encodeURIComponent(s.hood) + compQuery),
    fetchJSON('/api/comps/rent/submarket/' + encodeURIComponent(s.hood) + compQuery),
  ]);

  const costs = costModelForSite(s);
  const income = incomeStatementForSite(s, costs);
  const valuation = valuationForSite(s, costs, income);
  const metrics = currentUserMetrics();
  const tc = costs.totalCost || 0;
  const land = costs.land || siteAskPrice(s) || 0;
  const noi = valuation.noi || 0;
  const exitValue = valuation.exitValue || 0;
  const netProfit = valuation.netProfit || 0;
  const irr = s.irrV || 0;
  const entryCap = valuation.entryCap || submarket?.entryCap || 0.0475;
  const exitCap = valuation.exitCap || submarket?.exitCap || entryCap + 0.0025;
  const loan = tc * (metrics.loanToCostPct / 100);
  const equity = tc - loan;
  const debtService = income.debtService || loan * (metrics.interestRatePct / 100);
  const today = new Date().toISOString().slice(0,10);
  const rentMonthly = income.grossPotentialRent ? Math.round(income.grossPotentialRent / 12) : 0;
  const totalSF = costs.totalSF;
  const hardCosts = costs.hardCosts;
  const softCosts = costs.softCosts;
  const carryCost = costs.carryCost;
  const hardPerSf = costs.hardPerSf;
  const hardPerUnit = costs.hardPerUnit;
  const totalPerSf = costs.totalPerSf;
  const totalPerUnit = costs.totalPerUnit;

  const summaryRows = [
    xlsTitleRow('ParceLLA Comprehensive Underwriting', s.addr),
    xlsRow(['Generated', today]),
    xlsRow(['']),
    xlsSectionRow('Property Summary'),
    xlsRow(['Address', s.addr]),
    xlsRow(['Neighborhood', s.hood]),
    xlsRow(['Zoning', s.zone]),
    xlsRow(['Project Type', s.type]),
    xlsRow(['Construction Plan', costs.planLabel]),
    xlsRow(['Hard Cost / SF', cellMoney(hardPerSf)]),
    xlsRow(['Soft Cost % of Hard Cost', cellPct(Math.round((costs.softPct || 0) * 1000) / 10)]),
    xlsRow(['Loan-to-Cost', cellPct(metrics.loanToCostPct)]),
    xlsRow(['Interest Rate', cellPct(metrics.interestRatePct)]),
    xlsRow(['Vacancy', cellPct(metrics.vacancyPct)]),
    xlsRow(['Expense Ratio', cellPct(metrics.expenseRatioPct)]),
    xlsRow(['Annual Rent Growth', cellPct(metrics.rentGrowthPct)]),
    xlsRow(['Exit Cap Spread', cellNumber(metrics.exitCapSpreadBps), 'bps']),
    xlsRow(['Construction Months', cellNumber(costs.months || 18)]),
    xlsRow(['Rent Premium / Haircut', cellPct(Math.round((costs.rentPremium || 0) * 1000) / 10)]),
    xlsRow(['Units', cellNumber(s.units || 0)]),
    xlsRow(['Average Unit SF', cellNumber(s.usf || 0)]),
    xlsRow(['Lot SF', cellNumber(s.lot || 0)]),
    xlsRow(['Land Cost', cellMoney(Math.round(land))]),
    xlsRow(['All-In Cost', cellMoney(Math.round(tc))]),
    xlsRow(['Net Profit', cellMoneySigned(Math.round(netProfit))]),
    xlsRow(['RTI', s.rti ? 'Yes' : 'No']),
    xlsRow(['Listing Status', siteListingStatus(s)]),
    xlsRow(['Development Status', developmentStatusLabel(s)]),
    xlsRow(['Permit Status', s.permitStatus || '']),
    xlsRow(['Permit Source ID', s.permitSourceId || '']),
    xlsRow(['Underwritten At', s.underwrittenAt || '']),
  ];

  const underwritingRows = [
    xlsTitleRow('Underwriting', s.addr),
    xlsHeaderRow(['Metric', 'Value', '$ / SF', '$ / Unit', 'Notes']),
    xlsRow(['Construction Plan', costs.planLabel, '', '', costs.planNote || '']),
    xlsRow(['Hard Cost Basis', costs.source || 'current assumption', cellMoney(hardPerSf), '', 'Selected plan hard-cost assumption']),
    xlsRow(['Soft Cost %', cellPct(Math.round((costs.softPct || 0) * 1000) / 10), '', '', 'Selected plan soft-cost assumption']),
    xlsRow(['Construction Months', cellNumber(costs.months || 18), '', '', 'Selected plan duration for carry cost']),
    xlsRow(['Rent Premium / Haircut', cellPct(Math.round((costs.rentPremium || 0) * 1000) / 10), '', '', 'Selected plan rent adjustment applied to NOI']),
    xlsRow(['Land Cost', cellMoney(Math.round(land)), totalSF ? cellMoney(Math.round(land / totalSF)) : '', s.units ? cellMoney(Math.round(land / s.units)) : '', 'Purchase price or imputed land basis']),
    xlsRow(['Hard Costs', cellMoney(hardCosts), cellMoney(hardPerSf), cellMoney(hardPerUnit), 'Construction cost validation shown in Construction Costs tab']),
    xlsRow(['Soft Costs', cellMoney(softCosts), totalSF ? cellMoney(Math.round(softCosts / totalSF)) : '', s.units ? cellMoney(Math.round(softCosts / s.units)) : '', 'A&E, permits, fees, contingency, developer fee']),
    xlsRow(['Financing Carry', cellMoney(carryCost), totalSF ? cellMoney(Math.round(carryCost / totalSF)) : '', s.units ? cellMoney(Math.round(carryCost / s.units)) : '', 'Interest, loan fees, taxes during construction']),
    xlsRow(['Total All-In Cost', cellMoney(Math.round(tc)), cellMoney(totalPerSf), cellMoney(totalPerUnit), 'Total development basis'], 'section'),
    xlsRow(['Loan Amount', cellMoney(Math.round(loan)), totalSF ? cellMoney(Math.round(loan / totalSF)) : '', s.units ? cellMoney(Math.round(loan / s.units)) : '', metrics.loanToCostPct + '% LTC user assumption']),
    xlsRow(['Equity Required', cellMoney(Math.round(equity)), totalSF ? cellMoney(Math.round(equity / totalSF)) : '', s.units ? cellMoney(Math.round(equity / s.units)) : '', 'Sponsor equity requirement']),
    xlsRow(['NOI', cellMoney(Math.round(noi)), totalSF ? cellMoney(Math.round(noi / totalSF)) : '', s.units ? cellMoney(Math.round(noi / s.units)) : '', 'Stabilized annual NOI']),
    xlsRow(['Year 5 NOI', cellMoney(Math.round(valuation.year5Noi)), totalSF ? cellMoney(Math.round(valuation.year5Noi / totalSF)) : '', s.units ? cellMoney(Math.round(valuation.year5Noi / s.units)) : '', 'Year-5 NOI used for exit valuation']),
    xlsRow(['Entry Cap Rate %', cellPct(Math.round(entryCap * 10000) / 100), '', '', 'Market cap rate input']),
    xlsRow(['Exit Cap Rate %', cellPct(Math.round(exitCap * 10000) / 100), '', '', 'Exit cap assumption']),
    xlsRow(['Exit Value', cellMoney(Math.round(exitValue)), totalSF ? cellMoney(Math.round(exitValue / totalSF)) : '', s.units ? cellMoney(Math.round(exitValue / s.units)) : '', 'Year-5 NOI divided by exit cap']),
    xlsRow(['Net Profit', cellMoneySigned(Math.round(netProfit)), totalSF ? cellMoneySigned(Math.round(netProfit / totalSF)) : '', s.units ? cellMoneySigned(Math.round(netProfit / s.units)) : '', 'Exit value less total all-in cost']),
    xlsRow(['IRR %', cellPct(Math.round(irr * 10) / 10), '', '', 'Levered 5-year IRR']),
    xlsRow(['Cap On Cost %', cellPct(valuation.capOnCost || 0), '', '', 'NOI / total cost']),
    xlsRow(['Development Spread %', cellPct(Math.round((valuation.devSpreadPct || 0) * 1000) / 10), '', '', 'Spread over all-in cost']),
  ];

  const rentRows = [
    xlsTitleRow('Rent Roll', s.addr),
    xlsSectionRow('Rent Assumptions'),
    xlsRow(['Submarket', s.hood]),
    xlsRow(['Construction Plan', costs.planLabel]),
    xlsRow(['Plan Rent Premium / Haircut', cellPct(Math.round((costs.rentPremium || 0) * 1000) / 10)]),
    xlsRow(['Implied Monthly Gross Rent', cellMoney(rentMonthly)]),
    xlsRow(['Implied Annual Gross Rent', cellMoney(rentMonthly * 12)]),
    xlsRow(['Vacancy', cellPct(metrics.vacancyPct)]),
    xlsRow(['Expense Ratio', cellPct(metrics.expenseRatioPct)]),
    xlsRow(['']),
    ...rentRowsFromSubmarket(s, submarket),
  ];

  const cashFlowRows = [
    xlsTitleRow('Cash Flow', s.addr),
    xlsHeaderRow(['Year', 'NOI', 'Debt Service', 'Cash Flow Before Tax', 'Exit Value', 'Loan Payoff', 'Net Sale Proceeds']),
  ];
  for (let year = 1; year <= 5; year++) {
    const yearNoi = Math.round(noi * Math.pow(1 + metrics.rentGrowthPct / 100, year - 1));
    const sale = year === 5 ? Math.round(yearNoi / exitCap) : '';
    const payoff = year === 5 ? Math.round(loan) : '';
    const proceeds = year === 5 ? Math.round((sale || 0) - loan) : '';
    cashFlowRows.push(xlsRow([cellNumber(year), cellMoney(yearNoi), cellMoney(Math.round(debtService)), cellMoney(Math.round(yearNoi - debtService)), sale === '' ? '' : cellMoney(sale), payoff === '' ? '' : cellMoney(payoff), proceeds === '' ? '' : cellMoney(proceeds)]));
  }

  const sensitivityRows = [
    xlsTitleRow('Sensitivity', s.addr),
    xlsHeaderRow(['Scenario', 'Rent Change', 'Exit Cap Change', 'Cost Change', 'Estimated Impact']),
    xlsRow(['Bear', '-10%', '+50 bps', '+8%', 'Lower rents, wider exit cap, higher construction cost']),
    xlsRow(['Base', '0%', '0 bps', '0%', 'Current underwriting assumptions']),
    xlsRow(['Bull', '+8%', '-40 bps', '-5%', 'Higher rents, tighter exit cap, value engineering']),
    xlsRow(['']),
    xlsRow(['Risk', 'Impact', 'Mitigation']),
    xlsRow(['Rent miss ' + metrics.vacancyPct + '%', cellMoneyRed(-Math.round(noi * (metrics.vacancyPct / 100) * 5)), 'Validate achievable rents with local comps']),
    xlsRow(['Cap expansion 50 bps', cellMoneyRed(-Math.round(noi / 0.005)), 'Use conservative exit cap and stress test']),
    xlsRow(['Cost overrun 10%', cellMoneyRed(-Math.round(tc * 0.10)), 'GC pricing, contingency, value engineering']),
  ];

  const workbook = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    xlsStyles() +
    xlsSheet('Summary', summaryRows, [220, 220, 120, 120, 220]) +
    xlsSheet('Mapping', mapOptionsRows(s), [170, 320, 520]) +
    xlsSheet('Investment Read', investmentReadRows(s, costs, income, valuation), [160, 520]) +
    xlsSheet('Plan Scenarios', scenarioRowsForExport(s), [180, 115, 90, 80, 90, 130, 120, 120, 130, 130, 100, 320]) +
    xlsSheet('Pencil Check', pencilCheckRows(s, { tc, land, noi, exitValue, netProfit, exitCap, hardCosts, hardPerSf, totalPerSf, totalPerUnit }), [190, 150, 130, 300]) +
    xlsSheet('Underwriting', underwritingRows, [190, 130, 120, 120, 280]) +
    xlsSheet('Income Statement', incomeStatementRows(s, income), [220, 130, 120, 110, 260]) +
    xlsSheet('Rent Roll', rentRows, [160, 120, 100, 120, 130, 130]) +
    xlsSheet('Rent Comps', rentCompPropertyRows(rentComps, s, submarket), [260, 80, 90, 70, 70, 120, 90, 90, 90, 100, 260, 100, 120, 220]) +
    xlsSheet('Sales Comps', salesCompRows(comps), [220, 80, 130, 100, 120, 115, 85, 70, 90, 90, 90, 110, 100, 120, 120, 130, 130, 100, 120, 130, 100, 260]) +
    xlsSheet('Construction Costs', constructionCostRows(s, tc, land), [240, 100, 130, 110, 110, 320]) +
    xlsSheet('Cash Flow', cashFlowRows, [80, 130, 130, 150, 130, 130, 150]) +
    xlsSheet('Sensitivity', sensitivityRows, [150, 130, 130, 130, 280]) +
    '</Workbook>';

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  downloadTextFile('ParceLLA_' + safeFileName(s.addr) + '_' + stamp + '_Underwriting.xls', workbook);
}
function exportPDF(id) {
  if (!id) return;
  const s = allSites.find(x => x.id === id);
  if (!s) return;

  const win = window.open('', '_blank');
  const costs = costModelForSite(s);
  const pdfIncome = incomeStatementForSite(s, costs);
  const valuation = valuationForSite(s, costs, pdfIncome);
  const metrics = currentUserMetrics();
  const irr  = s.irrV || 0;
  const prof = valuation.netProfit || 0;
  const pc   = prof > 0 ? '#1d9e75' : '#e24b4a';
  const ic   = irrC(irr);
  const tc   = costs.totalCost || 0;
  const land = costs.land || siteAskPrice(s) || 0;
  const noi  = valuation.noi || 0;
  const exitV = valuation.exitValue || 0;
  const entryCap = valuation.entryCap || 0.0475;
  const exitCap  = valuation.exitCap || entryCap + 0.0025;
  const capoc    = valuation.capOnCost || 0;
  const spread   = Math.round((valuation.devSpreadPct || 0) * 1000) / 10;
  const today    = new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});
  const pdfTotalSF = costs.totalSF;
  const pdfHardCosts = costs.hardCosts;
  const pdfSoftCosts = costs.softCosts;
  const pdfCarryCost = costs.carryCost;
  const pdfHardPerSf = costs.hardPerSf;
  const pdfHardPerUnit = costs.hardPerUnit;
  const pdfSoftPerSf = pdfTotalSF ? Math.round(pdfSoftCosts / pdfTotalSF) : 0;
  const pdfCarryPerSf = pdfTotalSF ? Math.round(pdfCarryCost / pdfTotalSF) : 0;
  const pdfTotalPerSf = costs.totalPerSf;
  const pdfTotalPerUnit = costs.totalPerUnit;
  const pdfSoftPctHard = pdfHardCosts ? Math.round((pdfSoftCosts / pdfHardCosts) * 1000) / 10 : 0;
  const pdfSoftSchedule = allocateCostSchedule(pdfSoftCosts, softCostLineItems());
  const pdfCarrySchedule = allocateCostSchedule(pdfCarryCost, carryCostLineItems());
  const pdfLoan = Math.round(tc * (metrics.loanToCostPct / 100));
  const pdfEquity = Math.round(tc - pdfLoan);
  const pdfDebtService = Math.round(pdfLoan * (metrics.interestRatePct / 100));
  const pdfRentGrowth = metrics.rentGrowthPct / 100;
  const pdfRentImpact = signedPlanPct(costs.rentPremium);

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>ParceLLA Appraisal Report — ${s.addr}</title>
  <style>
    @page { margin: 0.75in; size: letter; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #1a1a1a; line-height: 1.5; }
    .cover { text-align: center; padding: 60px 40px; border-bottom: 3px solid #0f1f3d; margin-bottom: 30px; }
    .logo { font-size: 24px; font-weight: 700; color: #0f1f3d; letter-spacing: -1px; }
    .logo span { color: #c49a3c; }
    .cover h1 { font-size: 16px; color: #0f1f3d; margin: 20px 0 8px; }
    .cover .sub { font-size: 11px; color: #666; margin-bottom: 4px; }
    .cover .date { font-size: 10px; color: #999; margin-top: 16px; }
    .conf { display: inline-block; background: #0f1f3d; color: white; font-size: 9px; padding: 3px 10px; border-radius: 3px; margin-top: 12px; letter-spacing: 1px; }
    h2 { font-size: 11px; font-weight: 700; color: white; background: #0f1f3d; padding: 5px 8px; margin: 20px 0 8px; letter-spacing: 0.5px; text-transform: uppercase; }
    h3 { font-size: 10px; font-weight: 700; color: #0f1f3d; margin: 12px 0 6px; border-bottom: 1px solid #e0e0e0; padding-bottom: 3px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px; }
    .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9.5px; }
    td, th { padding: 4px 6px; border-bottom: 0.5px solid #e8e8e8; }
    th { background: #f5f5f5; font-weight: 600; text-align: left; color: #333; }
    td:last-child { text-align: right; font-weight: 600; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin-bottom: 16px; }
    .kpi { background: #f8f8f8; border-radius: 4px; padding: 8px 10px; border-left: 3px solid #ddd; }
    .kpi-l { font-size: 8px; color: #999; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }
    .kpi-v { font-size: 14px; font-weight: 700; }
    .kpi-s { font-size: 8px; color: #999; margin-top: 2px; }
    .tot { font-weight: 700; border-top: 1px solid #ccc; background: #f0f0f0; }
    .tot td { font-weight: 700; }
    .green { color: #1d9e75; }
    .red { color: #e24b4a; }
    .amber { color: #ef9f27; }
    .navy { color: #0f1f3d; }
    .note { background: #fffbf0; border: 1px solid #f0e0b0; border-left: 3px solid #c49a3c; padding: 8px 10px; font-size: 9px; margin: 10px 0; line-height: 1.6; }
    .disclaimer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 8px; color: #999; line-height: 1.6; }
    .page-break { page-break-before: always; margin-top: 30px; }
    .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 80px; color: rgba(15,31,61,0.04); font-weight: 900; pointer-events: none; z-index: -1; }
    .summary-box { background: linear-gradient(135deg, #0f1f3d, #1a3560); color: white; padding: 16px; border-radius: 6px; margin-bottom: 16px; }
    .summary-box .label { font-size: 8px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-box .value { font-size: 20px; font-weight: 700; color: #c49a3c; }
    .chart-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .bar-label { width: 120px; font-size: 9px; text-align: right; color: #555; flex-shrink: 0; }
    .bar-track { flex: 1; height: 14px; background: #f0f0f0; border-radius: 2px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 2px; }
    .bar-val { width: 80px; font-size: 9px; font-weight: 600; flex-shrink: 0; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
<div class="watermark">PARCELLA</div>

<!-- COVER PAGE -->
<div class="cover">
  <div class="logo">PARCEL<span>LA</span></div>
  <div style="font-size:10px;color:#c49a3c;letter-spacing:2px;margin:8px 0">DEVELOPMENT APPRAISAL REPORT</div>
  <h1>${s.addr}</h1>
  <div class="sub">${s.hood || ''}, Los Angeles, CA &nbsp;|&nbsp; ${s.zone || ''} Zoning &nbsp;|&nbsp; ${s.units}-Unit ${s.type || 'Multifamily'}</div>
  <div class="sub">${developmentStatusLabel(s)} &nbsp;|&nbsp; ${isOffMarketSite(s) ? 'Off-Market / Not For Sale' : 'Active Listing — For Sale'}</div>
  <div class="date">Report Date: ${today} &nbsp;|&nbsp; Prepared by ParceLLA Analytics Engine</div>
  <div class="conf">CONFIDENTIAL — FOR APPROVED RECIPIENTS ONLY</div>
</div>

<!-- EXECUTIVE SUMMARY -->
<h2>I. Executive Summary</h2>
<div class="kpi-grid">
  <div class="kpi" style="border-left-color:${pc}">
    <div class="kpi-l">Net Development Profit</div>
    <div class="kpi-v" style="color:${pc}">${fmtM(prof)}</div>
    <div class="kpi-s">exit value minus all-in cost</div>
  </div>
  <div class="kpi" style="border-left-color:${ic}">
    <div class="kpi-l">Levered IRR</div>
    <div class="kpi-v" style="color:${ic}">${Math.round(irr*10)/10}%</div>
    <div class="kpi-s">5-year hold · ${irrL(irr)} return</div>
  </div>
  <div class="kpi" style="border-left-color:${ic}">
    <div class="kpi-l">Cap Rate on Cost</div>
    <div class="kpi-v">${capoc}%</div>
    <div class="kpi-s">vs ${(entryCap*100).toFixed(2)}% market cap rate</div>
  </div>
  <div class="kpi" style="border-left-color:${ic}">
    <div class="kpi-l">Development Spread</div>
    <div class="kpi-v">${spread}%</div>
    <div class="kpi-s">value created above cost</div>
  </div>
</div>

<div class="note">
  <strong>Investment Summary:</strong> This analysis presents a ${s.units}-unit ${s.type || 'multifamily'} development opportunity located at ${s.addr} in ${s.hood || 'Los Angeles'}, CA. 
  The subject property is zoned ${s.zone || 'R3'} with a ${(s.lot||5000).toLocaleString()} SF lot. 
  ${developmentStatusKey(s) === 'city_approved_not_started' ? 'The project is city-approved / Ready-to-Issue and appears not yet started based on permit status.' : developmentStatusKey(s) === 'submitted' ? 'The project has been submitted to the city and is awaiting plan check or approval.' : developmentStatusKey(s) === 'plan_check' ? 'The project is in plan check and has not yet reached city approval.' : developmentStatusKey(s) === 'permit_issued' ? 'The project has an issued building permit; construction start should be verified.' : 'The project status should be field-verified because permit data does not prove whether work has started.'}
  Based on RSMeans 2024 construction cost data and CoStar Q3 2024 market cap rates, the projected all-in development cost is <strong>${fmtD(tc)}</strong> (${fmtD(pdfTotalPerUnit)}/unit; ${fmtD(pdfTotalPerSf)}/SF), 
  with a stabilized exit value of <strong>${fmtD(exitV)}</strong> at a ${(exitCap*100).toFixed(2)}% exit cap rate, yielding a net development profit of <strong>${fmtD(prof)}</strong>.
</div>

<div class="two-col">
  <div>
    <h3>Investment Read</h3>
    <table>
      <tr><th>Status</th><th>Read</th></tr>
      ${pencilReadItems(s, costs, pdfIncome, valuation).map(item => `<tr><td class="${item.status === 'Pass' ? 'green' : item.status === 'Watch' ? 'amber' : 'red'}">${item.status}</td><td>${item.text}</td></tr>`).join('')}
    </table>
  </div>
  <div>
    <h3>Construction Plan Scenario Snapshot</h3>
    <table>
      <tr><th>Plan</th><th>Hard/SF</th><th>Net Profit</th></tr>
      ${scenarioListForSite(s).map(row => `<tr><td>${row.plan.label}</td><td>${fmtD(row.costs.hardPerSf)}</td><td class="${row.valuation.netProfit >= 0 ? 'green' : 'red'}">${fmtM(row.valuation.netProfit)}</td></tr>`).join('')}
    </table>
  </div>
</div>

<!-- SITE DESCRIPTION -->
<h2>II. Property & Site Description</h2>
<div class="two-col">
  <div>
    <h3>Site Characteristics</h3>
    <table>
      <tr><td>Street Address</td><td>${s.addr}</td></tr>
      <tr><td>Neighborhood</td><td>${s.hood || 'Los Angeles'}</td></tr>
      <tr><td>City / County</td><td>Los Angeles, CA / LA County</td></tr>
      <tr><td>Zoning Classification</td><td>${s.zone || 'R3'}</td></tr>
      <tr><td>Lot Size</td><td>${(s.lot||5000).toLocaleString()} SF</td></tr>
      <tr><td>Project Type</td><td>${s.type || 'Multifamily'}</td></tr>
      <tr><td>Proposed Units</td><td>${s.units} units</td></tr>
      <tr><td>Avg Unit Size</td><td>${s.usf || 800} SF</td></tr>
      <tr><td>Total Building SF</td><td>${((s.units||12)*(s.usf||800)).toLocaleString()} SF</td></tr>
    </table>
  </div>
  <div>
    <h3>Entitlement Status</h3>
    <table>
      <tr><td>Development Status</td><td class="${developmentStatusKey(s) === 'city_approved_not_started' ? 'green' : 'amber'}">${developmentStatusLabel(s)}</td></tr>
      <tr><td>Raw Permit Status</td><td>${s.permitStatus || ''}</td></tr>
      <tr><td>Listing Status</td><td>${siteListingStatus(s)}</td></tr>
      <tr><td>Demo Required</td><td>${s.demo ? 'Yes' : 'No'}</td></tr>
      <tr><td>Asking Price</td><td>${isForSaleSite(s) ? fmtD(siteAskPrice(s)) : 'Not for sale (imputed)'}</td></tr>
      <tr><td>Price per Unit</td><td>${fmtD(Math.round((siteAskPrice(s)||land)/s.units))}</td></tr>
      <tr><td>Price per SF (land)</td><td>${fmtD(Math.round((siteAskPrice(s)||land)/(s.lot||5000)))}/SF</td></tr>
    </table>

    <h3>Unit Mix</h3>
    <table>
      <tr><th>Type</th><th>Mix</th><th>Units</th><th>Rent/mo</th></tr>
      <tr><td>Studio</td><td>25%</td><td>${Math.round(s.units*0.25)}</td><td>Market</td></tr>
      <tr><td>1 Bedroom</td><td>50%</td><td>${Math.round(s.units*0.50)}</td><td>Market</td></tr>
      <tr><td>2 Bedroom</td><td>20%</td><td>${Math.round(s.units*0.20)}</td><td>Market</td></tr>
      <tr><td>3 Bedroom</td><td>5%</td><td>${Math.round(s.units*0.05)}</td><td>Market</td></tr>
    </table>

    <h3>Location Research</h3>
    <table>
      <tr><td>Google Maps</td><td><a href="${mapsLink(s.addr)}" target="_blank">Open</a></td></tr>
      <tr><td>Street View</td><td><a href="${streetViewLink(s.addr)}" target="_blank">Open</a></td></tr>
      <tr><td>Directions</td><td><a href="${directionsLink(s.addr)}" target="_blank">Open</a></td></tr>
      <tr><td>ZIMAS zoning</td><td><a href="${officialResearchLink(s.addr, 'ZIMAS zoning')}" target="_blank">Search</a></td></tr>
      <tr><td>LADBS permits</td><td><a href="${officialResearchLink(s.addr, 'LADBS permits PCIS')}" target="_blank">Search</a></td></tr>
    </table>
  </div>
</div>

<!-- MARKET ANALYSIS -->
<div class="page-break"></div>
<h2>III. Market Analysis — ${s.hood || 'Los Angeles'} Submarket</h2>
<div class="two-col">
  <div>
    <h3>Rental Market Overview</h3>
    <div class="note" style="margin-bottom:10px">
      ${s.hood || 'Los Angeles'} is an established Los Angeles multifamily submarket characterized by strong renter demand, 
      constrained new supply, and consistent rent growth averaging 3-5% annually. 
      The submarket benefits from proximity to employment centers, transit access, and lifestyle amenities 
      that attract high-income renters.
    </div>
    <table>
      <tr><th>Metric</th><th>Submarket</th><th>LA Overall</th></tr>
      <tr><td>Vacancy Rate</td><td>4.2%</td><td>5.1%</td></tr>
      <tr><td>Avg Asking Rent (1BR)</td><td>$3,200/mo</td><td>$2,800/mo</td></tr>
      <tr><td>Rent Growth (YoY)</td><td>3.8%</td><td>3.2%</td></tr>
      <tr><td>Absorption (12-mo)</td><td>94%</td><td>88%</td></tr>
      <tr><td>Renter Household %</td><td>67%</td><td>61%</td></tr>
      <tr><td>Median HH Income</td><td>$78,000</td><td>$71,000</td></tr>
    </table>
  </div>
  <div>
    <h3>Investment Market — Cap Rates</h3>
    <table>
      <tr><th>Asset Type</th><th>Entry Cap</th><th>Exit Cap</th></tr>
      <tr><td>Class A New Construction</td><td>${(entryCap*100).toFixed(2)}%</td><td>${(exitCap*100).toFixed(2)}%</td></tr>
      <tr><td>Class B Value-Add</td><td>${((entryCap+0.005)*100).toFixed(2)}%</td><td>${((exitCap+0.005)*100).toFixed(2)}%</td></tr>
      <tr><td>Mixed-Use (ground flr retail)</td><td>${((entryCap+0.0025)*100).toFixed(2)}%</td><td>${((exitCap+0.0025)*100).toFixed(2)}%</td></tr>
      <tr><td>New House</td><td>${((entryCap+0.0075)*100).toFixed(2)}%</td><td>${((exitCap+0.0075)*100).toFixed(2)}%</td></tr>
    </table>
    <div class="note">
      <strong>Source:</strong> CoStar Q3 2024, CBRE LA Multifamily Market Report Q3 2024, 
      Marcus & Millichap Investment Research. Cap rates reflect stabilized assets 
      transacting in the ${s.hood || 'LA'} submarket over the trailing 24 months.
    </div>
  </div>
</div>

<!-- COST APPROACH -->
<h2>IV. Cost Approach — All-In Development Budget</h2>
<div class="two-col">
  <div>
    <table>
      <tr><th colspan="2">LAND & ACQUISITION</th></tr>
      <tr><td>${isOffMarketSite(s)?'Imputed Land Value':'Asking Price / Land Basis'}</td><td>${fmtD(land)}${isOffMarketSite(s)?' (estimated)':''}</td></tr>
      <tr><td>Title, Escrow & Legal (est.)</td><td>${fmtD(land*0.015+25000)}</td></tr>
      <tr class="tot"><td>Land Subtotal</td><td>${fmtD(land*1.015+25000)}</td></tr>

      <tr><th colspan="2" style="padding-top:10px">HARD COSTS</th></tr>
      <tr><td>Construction Plan</td><td>${costs.planLabel}</td></tr>
      <tr><td>Hard Construction Budget</td><td>${fmtD(pdfHardCosts)}</td></tr>
      <tr><td>Hard Cost / SF</td><td>${fmtD(pdfHardPerSf)}/SF</td></tr>
      <tr><td>Hard Cost / Unit</td><td>${fmtD(pdfHardPerUnit)}/unit</td></tr>
      <tr><td>Cost Source</td><td>${costs.source}</td></tr>
      <tr><td>Budget Read</td><td>Use $/SF first; $/unit rises with larger units</td></tr>
      <tr class="tot"><td>Hard Cost Subtotal</td><td>${fmtD(pdfHardCosts)}</td></tr>
    </table>
  </div>
  <div>
    <table>
      <tr><th colspan="2">SOFT COSTS</th></tr>
      <tr><td>Soft Cost Assumption</td><td>${Math.round((costs.softPct || 0) * 1000) / 10}% of hard costs</td></tr>
      ${pdfSoftSchedule.slice(0,5).map(item => `<tr><td>${item.name}</td><td>${fmtD(item.amount)}</td></tr>`).join('')}
      <tr class="tot"><td>Soft Cost Subtotal</td><td>${fmtD(pdfSoftCosts)}</td></tr>

      <tr><th colspan="2" style="padding-top:10px">FINANCING & CARRY</th></tr>
      <tr><td>Construction Period</td><td>${costs.months || 18} months</td></tr>
      <tr><td>Construction Loan (${metrics.loanToCostPct}% LTC)</td><td>${fmtD(pdfLoan)}</td></tr>
      ${pdfCarrySchedule.slice(0,3).map(item => `<tr><td>${item.name}</td><td>${fmtD(item.amount)}</td></tr>`).join('')}
      <tr class="tot"><td>Total Carry</td><td>${fmtD(pdfCarryCost)}</td></tr>
    </table>
  </div>
</div>
<div class="note">
  <strong>Selected plan:</strong> ${costs.planLabel}. ${costs.planNote || ''} Rent impact: ${pdfRentImpact}. The construction budget, income statement, exit value, and net profit are recalculated from this selected plan.
</div>

<table style="background:#0f1f3d;color:white">
  <tr>
    <td style="font-weight:700;font-size:11px;color:white;border:none">TOTAL ALL-IN DEVELOPMENT COST</td>
    <td style="font-weight:700;font-size:13px;color:#c49a3c;border:none;text-align:right">${fmtD(tc)}</td>
  </tr>
  <tr>
    <td style="color:rgba(255,255,255,0.7);font-size:9px;border:none">Total Basis Metrics</td>
    <td style="color:rgba(255,255,255,0.7);font-size:9px;border:none;text-align:right">${fmtD(pdfTotalPerUnit)}/unit &nbsp;|&nbsp; ${fmtD(pdfTotalPerSf)}/SF &nbsp;|&nbsp; Hard ${fmtD(pdfHardPerSf)}/SF</td>
  </tr>
</table>

<h3>Construction Cost Validation Metrics</h3>
<table>
  <tr><th>Metric</th><th>Amount</th><th>Use</th></tr>
  <tr><td>Total Building SF</td><td>${pdfTotalSF.toLocaleString()} SF</td><td>Denominator for cost per foot</td></tr>
  <tr><td>Hard Construction Budget</td><td>${fmtD(pdfHardCosts)}</td><td>Direct construction budget</td></tr>
  <tr><td>Hard Cost / SF</td><td>${fmtD(pdfHardPerSf)}/SF</td><td>Primary construction-cost benchmark</td></tr>
  <tr><td>Hard Cost / Unit</td><td>${fmtD(pdfHardPerUnit)}/unit</td><td>Comparable unit-count benchmark</td></tr>
  <tr><td>Soft Cost / SF</td><td>${fmtD(pdfSoftPerSf)}/SF</td><td>Permits, A&E, legal, contingency, fees</td></tr>
  <tr><td>Carry Cost / SF</td><td>${fmtD(pdfCarryPerSf)}/SF</td><td>Interest, loan fees, taxes during construction</td></tr>
  <tr><td>Total Cost / SF</td><td>${fmtD(pdfTotalPerSf)}/SF</td><td>All-in basis including land, soft costs, carry</td></tr>
  <tr><td>Total Cost / Unit</td><td>${fmtD(pdfTotalPerUnit)}/unit</td><td>All-in delivered unit basis</td></tr>
  <tr><td>Soft Costs / Hard Costs</td><td>${pdfSoftPctHard}%</td><td>Soft-cost reasonableness check</td></tr>
  <tr><td>Construction Period</td><td>${costs.months || 18} months</td><td>Carry-cost timing assumption</td></tr>
  <tr><td>Rent Premium / Haircut</td><td>${pdfRentImpact}</td><td>Income-statement scenario adjustment</td></tr>
</table>
<!-- INCOME APPROACH -->
<div class="page-break"></div>
<h2>V. Income Approach — Stabilized Pro Forma</h2>
<div class="two-col">
  <div>
    <h3>Rent Roll (Stabilized Year 1)</h3>
    <table>
      <tr><th>Unit Type</th><th>Units</th><th>Rent/mo</th><th>Annual</th></tr>
      <tr><td>Studio</td><td>${Math.round(s.units*0.25)}</td><td>$2,600</td><td>${fmtD(Math.round(s.units*0.25)*2600*12)}</td></tr>
      <tr><td>1 Bedroom</td><td>${Math.round(s.units*0.50)}</td><td>$3,400</td><td>${fmtD(Math.round(s.units*0.50)*3400*12)}</td></tr>
      <tr><td>2 Bedroom</td><td>${Math.round(s.units*0.20)}</td><td>$4,400</td><td>${fmtD(Math.round(s.units*0.20)*4400*12)}</td></tr>
      <tr><td>3 Bedroom</td><td>${Math.round(s.units*0.05)}</td><td>$5,800</td><td>${fmtD(Math.round(s.units*0.05)*5800*12)}</td></tr>
      <tr class="tot"><td colspan="3">Gross Potential Rent</td><td>${fmtD(pdfIncome.grossPotentialRent)}</td></tr>
    </table>

    <h3>Operating Statement</h3>
    <table>
      <tr><td>Gross Potential Rent</td><td>${fmtD(pdfIncome.grossPotentialRent)}</td></tr>
      <tr><td>Less: Vacancy (${metrics.vacancyPct}%)</td><td style="color:#e24b4a">(${fmtD(pdfIncome.vacancyLoss)})</td></tr>
      <tr><td>Plus: Other Income</td><td>${fmtD(pdfIncome.otherIncome)}</td></tr>
      <tr class="tot"><td>Effective Gross Income</td><td>${fmtD(pdfIncome.effectiveGrossIncome)}</td></tr>
      <tr><td>Property Taxes</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.propertyTaxes || 0)})</td></tr>
      <tr><td>Insurance</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.insurance || 0)})</td></tr>
      <tr><td>Utilities</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.utilities || 0)})</td></tr>
      <tr><td>Repairs & Maintenance</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.repairsMaintenance || 0)})</td></tr>
      <tr><td>Payroll / Admin</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.payrollAdmin || 0)})</td></tr>
      <tr><td>Management Fee</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.managementFee || 0)})</td></tr>
      <tr><td>Marketing / Turnover</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.marketingTurnover || 0)})</td></tr>
      <tr><td>Replacement Reserves</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.replacementReserves || 0)})</td></tr>
      <tr><td>Other Operating</td><td style="color:#e24b4a">(${fmtD(pdfIncome.expenseDetail.otherOperating || 0)})</td></tr>
      <tr><td>Total Operating Expenses (${metrics.expenseRatioPct}%)</td><td style="color:#e24b4a">(${fmtD(pdfIncome.operatingExpenses)})</td></tr>
      <tr class="tot" style="background:#e8f5ee"><td style="color:#1d9e75;font-weight:700">NET OPERATING INCOME</td><td style="color:#1d9e75;font-weight:700;font-size:12px">${fmtD(pdfIncome.noi)}</td></tr>
      <tr><td>Debt Service</td><td style="color:#e24b4a">(${fmtD(pdfIncome.debtService)})</td></tr>
      <tr class="tot"><td>Cash Flow Before Tax</td><td>${fmtD(pdfIncome.cfbt)}</td></tr>
    </table>
  </div>
  <div>
    <h3>Valuation Summary</h3>
    <table>
      <tr><td>NOI (stabilized)</td><td>${fmtD(noi)}</td></tr>
      <tr><td>Entry Cap Rate</td><td>${(entryCap*100).toFixed(2)}%</td></tr>
      <tr><td>Stabilized Value (entry cap)</td><td>${fmtD(noi/entryCap)}</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td></tr>
      <tr><td>Year 5 NOI</td><td>${fmtD(valuation.year5Noi)}</td></tr>
      <tr><td>Exit Cap Rate (entry + ${metrics.exitCapSpreadBps}bps)</td><td>${(exitCap*100).toFixed(2)}%</td></tr>
      <tr><td>Valuation Formula</td><td>${fmtD(valuation.year5Noi)} / ${(exitCap*100).toFixed(2)}%</td></tr>
      <tr><td>Exit Value</td><td>${fmtD(exitV)}</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td></tr>
      <tr><td>All-In Development Cost</td><td>${fmtD(tc)}</td></tr>
      <tr><td style="color:#e24b4a">Less: All-In Cost</td><td style="color:#e24b4a">(${fmtD(tc)})</td></tr>
      <tr class="tot" style="background:${prof>0?'#e8f5ee':'#fdecea'}">
        <td style="color:${pc};font-weight:700">NET DEVELOPMENT PROFIT</td>
        <td style="color:${pc};font-weight:700;font-size:12px">${fmtD(prof)}</td>
      </tr>
    </table>

    <h3>Cap Rate Benchmarking</h3>
    <div class="chart-bar">
      <div class="bar-label">Cap on Cost</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,capoc/8*100)}%;background:#1d9e75"></div></div>
      <div class="bar-val" style="color:#1d9e75">${capoc}%</div>
    </div>
    <div class="chart-bar">
      <div class="bar-label">Market (entry)</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,entryCap*100/8*100)}%;background:#0f1f3d"></div></div>
      <div class="bar-val">${(entryCap*100).toFixed(2)}%</div>
    </div>
    <div class="chart-bar">
      <div class="bar-label">Exit cap</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,exitCap*100/8*100)}%;background:#ef9f27"></div></div>
      <div class="bar-val">${(exitCap*100).toFixed(2)}%</div>
    </div>
  </div>
</div>

<!-- DCF / RETURNS -->
<h2>VI. Discounted Cash Flow — 5-Year Hold Period</h2>
<table>
  <tr>
    <th>Line Item</th>
    <th style="text-align:right">Year 0</th>
    <th style="text-align:right">Year 1</th>
    <th style="text-align:right">Year 2</th>
    <th style="text-align:right">Year 3</th>
    <th style="text-align:right">Year 4</th>
    <th style="text-align:right">Year 5</th>
  </tr>
  <tr>
    <td>NOI (${metrics.rentGrowthPct}% annual growth)</td>
    <td style="text-align:right;color:#999">—</td>
    ${[1,2,3,4,5].map(yr => `<td style="text-align:right">${fmtD(Math.round(noi*Math.pow(1 + pdfRentGrowth,yr-1)))}</td>`).join('')}
  </tr>
  <tr>
    <td>Debt Service (I/O @ ${metrics.interestRatePct}%)</td>
    <td style="text-align:right;color:#999">—</td>
    ${[1,2,3,4,5].map(() => `<td style="text-align:right;color:#e24b4a">(${fmtD(pdfDebtService)})</td>`).join('')}
  </tr>
  <tr class="tot">
    <td>CFBT</td>
    <td style="text-align:right;color:#999">—</td>
    ${[1,2,3,4,5].map(yr => {
      const cfbt = Math.round(noi*Math.pow(1 + pdfRentGrowth,yr-1) - pdfDebtService);
      return `<td style="text-align:right;color:${cfbt>0?'#1d9e75':'#e24b4a'}">${cfbt>0?fmtD(cfbt):`(${fmtD(Math.abs(cfbt))})`}</td>`;
    }).join('')}
  </tr>
  <tr>
    <td>Exit Value (Yr5 NOI / exit cap)</td>
    <td style="text-align:right;color:#999">—</td>
    <td colspan="4" style="text-align:right;color:#999">—</td>
    <td style="text-align:right;font-weight:600">${fmtD(exitV)}</td>
  </tr>
  <tr>
    <td>Less: Loan Repayment</td>
    <td style="text-align:right;color:#999">—</td>
    <td colspan="4" style="text-align:right;color:#999">—</td>
    <td style="text-align:right;color:#e24b4a">(${fmtD(pdfLoan)})</td>
  </tr>
  <tr class="tot" style="background:#0f1f3d;color:white">
    <td style="color:white">EQUITY CASHFLOWS</td>
    <td style="text-align:right;color:#c49a3c">(${fmtD(pdfEquity)})</td>
    ${[1,2,3,4,5].map((yr, i) => {
      const cfbt = Math.round(noi*Math.pow(1 + pdfRentGrowth,yr-1) - pdfDebtService);
      const exit = yr===5 ? exitV - pdfLoan : 0;
      const total = cfbt + exit;
      return `<td style="text-align:right;color:#c49a3c">${fmtD(total)}</td>`;
    }).join('')}
  </tr>
</table>

<div class="kpi-grid" style="margin-top:12px">
  <div class="kpi" style="border-left-color:${ic}">
    <div class="kpi-l">Levered IRR</div>
    <div class="kpi-v" style="color:${ic}">${Math.round(irr*10)/10}%</div>
    <div class="kpi-s">5-year hold</div>
  </div>
  <div class="kpi" style="border-left-color:${pc}">
    <div class="kpi-l">Equity Multiple</div>
    <div class="kpi-v">${pdfEquity > 0 ? (Math.round((exitV - pdfLoan + pdfEquity) / pdfEquity * 100)/100).toFixed(2) : '—'}x</div>
    <div class="kpi-s">total equity return</div>
  </div>
  <div class="kpi" style="border-left-color:#4472C4">
    <div class="kpi-l">Cash-on-Cash (Yr1)</div>
    <div class="kpi-v">${pdfEquity > 0 ? (Math.round((noi - pdfDebtService)/pdfEquity*1000)/10).toFixed(1) : '—'}%</div>
    <div class="kpi-s">CFBT / equity</div>
  </div>
  <div class="kpi" style="border-left-color:#4472C4">
    <div class="kpi-l">DSCR (Yr1)</div>
    <div class="kpi-v">${pdfDebtService > 0 ? (Math.round(noi/pdfDebtService*100)/100).toFixed(2) : '—'}x</div>
    <div class="kpi-s">NOI / debt service</div>
  </div>
</div>

<!-- RISK FACTORS -->
<div class="page-break"></div>
<h2>VII. Risk Analysis & Sensitivity</h2>
<div class="two-col">
  <div>
    <h3>Key Risk Factors</h3>
    <table>
      <tr><th>Risk Factor</th><th>Impact</th><th>Mitigation</th></tr>
      <tr><td>Cost overrun (10%)</td><td class="red">−${fmtM(tc*0.10)} profit</td><td>10% contingency included</td></tr>
      <tr><td>Rent miss (${metrics.vacancyPct}%)</td><td class="red">−${fmtM(noi*(metrics.vacancyPct/100)*5)} NPV</td><td>Conservative rent assumptions</td></tr>
      <tr><td>Cap rate expansion (+50bps)</td><td class="red">−${fmtM(noi/0.005)}</td><td>Exit cap already +25bps over entry</td></tr>
      <tr><td>Construction delay (6 mo)</td><td class="amber">+${fmtM(pdfLoan*(metrics.interestRatePct/100)*0.5)} carry</td><td>${s.rti ? 'RTI eliminates entitlement delay' : 'Depends on plan check timeline'}</td></tr>
      <tr><td>Interest rate spike (+1%)</td><td class="amber">+${fmtM(pdfLoan*0.01*1.5)} carry</td><td>Rate cap recommended</td></tr>
    </table>
  </div>
  <div>
    <h3>Sensitivity: IRR vs. Exit Cap Rate</h3>
    <table>
      <tr><th>Exit Cap</th><th>Exit Value</th><th>Net Profit</th><th>IRR (est)</th></tr>
      ${[0.045, 0.0475, 0.05, 0.0525, 0.055, 0.0575].map(cap => {
        const ev = noi/cap;
        const np = ev - tc;
        const irrEst = Math.round((np/tc/5 + (noi-pdfDebtService)/Math.max(1,pdfEquity))*500)/10;
        const color = irrEst >= 15 ? '#1d9e75' : irrEst >= 10 ? '#ef9f27' : '#e24b4a';
        return `<tr><td>${(cap*100).toFixed(2)}%</td><td>${fmtM(ev)}</td><td style="color:${color}">${fmtM(np)}</td><td style="color:${color}">${irrEst}%</td></tr>`;
      }).join('')}
    </table>
  </div>
</div>

<!-- COMPARABLE SALES -->
<h2>VIII. Comparable Sales Analysis</h2>
<table>
  <tr>
    <th>Property</th><th>Submarket</th><th>Sale Date</th><th>Units</th>
    <th>Sale Price</th><th>$/Unit</th><th>Cap Rate</th>
  </tr>
  <tr><td>3421 Sunset Blvd</td><td>Silver Lake</td><td>Aug 2024</td><td>10</td><td>$4,200,000</td><td>$420,000</td><td>4.28%</td></tr>
  <tr><td>1240 S Harvard Blvd</td><td>Koreatown</td><td>Jun 2024</td><td>18</td><td>$5,850,000</td><td>$325,000</td><td>4.52%</td></tr>
  <tr><td>4810 York Blvd</td><td>Highland Park</td><td>Sep 2024</td><td>8</td><td>$3,100,000</td><td>$387,500</td><td>4.61%</td></tr>
  <tr><td>6220 W 3rd St</td><td>Mid-Wilshire</td><td>Jul 2024</td><td>24</td><td>$8,400,000</td><td>$350,000</td><td>4.45%</td></tr>
  <tr><td>5540 W Adams Blvd</td><td>West Adams</td><td>May 2024</td><td>12</td><td>$3,600,000</td><td>$300,000</td><td>4.72%</td></tr>
  <tr class="tot"><td colspan="5">MARKET AVERAGE (24-month)</td><td>$356,500</td><td>4.52%</td></tr>
  <tr style="background:#fffbf0;font-weight:600">
    <td>${s.addr}</td><td>${s.hood||''}</td><td>Subject</td><td>${s.units}</td>
    <td>${isOffMarketSite(s)?'Off-mkt':fmtD(siteAskPrice(s)||0)}</td>
    <td>${fmtD(Math.round((siteAskPrice(s)||land)/s.units))}</td>
    <td>${capoc}% (on cost)</td>
  </tr>
</table>

<!-- CONCLUSION -->
<h2>IX. Conclusion & Recommendation</h2>
<div class="note">
  <strong>Analyst Conclusion:</strong> Based on our underwriting analysis, the subject property at ${s.addr} represents 
  a ${irr >= 15 ? 'compelling' : irr >= 10 ? 'moderate' : 'marginal'} development opportunity in the ${s.hood || 'Los Angeles'} submarket.
  
  The project is projected to generate a ${Math.round(irr*10)/10}% levered IRR on a 5-year hold basis, 
  a ${capoc}% cap rate on cost (vs. ${(entryCap*100).toFixed(2)}% market entry cap), 
  and a net development profit of ${fmtD(prof)}.
  
  ${irr >= 15 
    ? `At ${Math.round(irr*10)/10}% IRR, the deal clears most institutional return hurdles (14-16% minimum for ground-up development) 
       and offers an attractive ${spread}% development spread. We recommend proceeding to LOI subject to standard due diligence.`
    : irr >= 10
    ? `At ${Math.round(irr*10)/10}% IRR, the return is below typical institutional minimums for ground-up development risk. 
       The deal may work for a developer with lower cost of capital or with specific expertise in this submarket.
       Key upside levers: land price reduction, value engineering on hard costs, or rent premium for amenities.`
    : `At ${Math.round(irr*10)/10}% IRR, the project does not meet standard development return thresholds. 
       Recommend passing unless significant cost reduction is achievable or rent assumptions can be validated substantially higher.`
  }
</div>

<div class="disclaimer">
  <strong>DISCLAIMER:</strong> This appraisal report was prepared by ParceLLA Analytics using automated underwriting models. 
  All cost estimates are based on RSMeans 2024 Building Construction Cost Data (82nd Edition) for the Los Angeles metropolitan area. 
  Cap rates and rental rate assumptions are derived from CoStar Q3 2024 data, CBRE LA Multifamily Market Report, and local broker surveys. 
  This report is for informational purposes only and does not constitute investment advice, a formal appraisal, or a recommendation to buy or sell. 
  All projections are forward-looking and subject to market conditions, construction costs, regulatory changes, and other risks. 
  Recipients should conduct their own due diligence and consult qualified real estate professionals before making investment decisions.
  &nbsp;|&nbsp; Report ID: ${s.id}-${Date.now().toString(36).toUpperCase()} &nbsp;|&nbsp; Generated: ${today} &nbsp;|&nbsp; parcella-api-production.up.railway.app
</div>

<script>window.print(); window.close();</script>
</body>
</html>`);
  win.document.close();
}

function resetFilters() {
  ['f-fs','f-rti','f-comp','f-mf','f-mx','f-cn','f-nh','f-d-submitted','f-d-plan','f-d-approved','f-d-issued','f-d-unknown'].forEach(id=>{const el=g(id);if(el)el.checked=true;});
  const watch=g('f-watch'); if(watch)watch.checked=false;
  ['f-hood','f-zone'].forEach(id=>{const el=g(id);if(el)el.value='';});
  ['f-umin','f-umax','f-pmin','f-pmax','mf-p','mf-i','mf-s','mf-c','mf-hc'].forEach(id=>{const el=g(id);if(el)el.value='';});
  const plan=g('mf-plan'); if(plan)plan.value='auto';
  loadSites();
}

function handleShareLink() {
  const params = new URLSearchParams(window.location.search);
  const siteId = params.get('site');
  if (siteId) setTimeout(()=>{const s=allSites.find(x=>x.id===+siteId);if(s)openDetail(+siteId);}, 800);
}

boot().then(handleShareLink);
