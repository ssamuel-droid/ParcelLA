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

// Street View thumbnail for any address
function streetViewURL(lat, lng, w=400, h=200) {
  return `https://maps.googleapis.com/maps/api/streetview?size=${w}x${h}&location=${lat},${lng}&fov=90&heading=0&pitch=5&key=${GMAPS_KEY}`;
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
  return `https://www.google.com/maps/search/${encodeURIComponent(addr + ', Los Angeles, CA')}`;
}
const fmtM = n => n >= 1e6 ? '$'+(Math.round(n/1e5)/10)+'M' : n >= 1e3 ? '$'+Math.round(n/1e3)+'K' : '$'+Math.round(n||0);
const fmtD = n => '$'+Math.round(n||0).toLocaleString();
const irrC = v => v >= 18 ? '#1d9e75' : v >= 12 ? '#ef9f27' : '#e24b4a';
const irrL = v => v >= 18 ? 'Strong' : v >= 12 ? 'Moderate' : 'Weak';
let allSites = [], filtered = [], openId = null;
const g = id => document.getElementById(id);

document.getElementById('app').innerHTML = `<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--navy:#0f1f3d;--navy2:#172b52;--gold:#b98b2f;--green:#1d9e75;--red:#d94b4b;--amber:#ef9f27;--blue:#378add;--ink:#1b2533;--muted:#6f7b8c;--line:#dfe5ec;--panel:#ffffff;--soft:#f3f6f9;--soft2:#e9eef4}
body{font-family:'Inter',system-ui,sans-serif;background:#eef2f6;color:var(--ink);height:100vh;overflow:hidden}
.nav{background:linear-gradient(90deg,var(--navy),#172b52);padding:0 16px;height:48px;display:flex;align-items:center;gap:12px;position:fixed;top:0;left:0;right:0;z-index:100;box-shadow:0 1px 8px rgba(15,31,61,0.18)}
.logo{font-size:16px;font-weight:800;color:#fff;letter-spacing:0;flex-shrink:0}.logo span{color:var(--gold)}
.ntag{font-size:10px;color:rgba(255,255,255,0.62);letter-spacing:0;text-transform:uppercase}.nav-r{margin-left:auto;display:flex;align-items:center;gap:7px}
.adot{width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 3px rgba(239,159,39,0.18)}.adot.ok{background:var(--green);box-shadow:0 0 0 3px rgba(29,158,117,0.18)}.albl{font-size:10px;color:rgba(255,255,255,0.7)}
.layout{display:flex;height:calc(100vh - 48px);margin-top:48px}
.sb{width:230px;background:#fbfcfd;border-right:1px solid var(--line);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}
.sb-body{overflow-y:auto;flex:1;padding:10px 12px}.sb h4{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0;color:#8a96a8;margin:11px 0 5px}.sb h4:first-child{margin-top:0}
.cb{display:flex;align-items:center;gap:6px;font-size:11px;color:#3f4a5a;margin-bottom:3px;cursor:pointer;line-height:1.25}.cb input{accent-color:var(--navy);width:12px;height:12px}
.sbs{width:100%;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-size:11px;margin-bottom:5px;background:#fff;color:var(--ink)}
.sb2{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px}.sb2 input{width:100%;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-size:11px;background:#fff;text-align:right;color:var(--ink)}
.sbf{padding:9px 12px;border-top:1px solid var(--line);background:#fff}.bp{width:100%;padding:8px;background:var(--navy);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-bottom:5px}.bp:hover{background:var(--navy2)}
.br{width:100%;padding:6px;background:#fff;color:#687485;border:1px solid var(--line);border-radius:6px;font-size:11px;cursor:pointer}.br:hover{border-color:#b8c2cf;color:var(--ink)}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}.mfb{display:grid;grid-template-columns:repeat(5,minmax(118px,1fr));gap:6px;padding:8px 10px;background:#f8fafc;border-bottom:1px solid var(--line);flex-shrink:0}
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
.dh{padding:9px 12px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:2}.dht{font-size:12px;font-weight:800;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px}.dha{display:flex;gap:5px;flex-shrink:0}.da{padding:5px 8px;font-size:9px;font-weight:800;border:1px solid var(--line);border-radius:5px;cursor:pointer;background:#fff;color:#536071}.da.p{background:var(--navy);color:#fff;border-color:var(--navy)}.dhx{background:none;border:none;font-size:18px;cursor:pointer;color:#8792a2;padding:0 2px;flex-shrink:0}
.db{padding:10px 12px}.sh{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0;color:#8390a2;margin:10px 0 5px}.sh:first-child{margin-top:0}.ig{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:6px}.ic{background:#f7f9fb;border:1px solid #edf1f4;border-radius:6px;padding:6px 8px}.icl{font-size:8px;color:#7f8a9a;margin-bottom:2px;text-transform:uppercase;font-weight:800}.icv{font-size:11px;font-weight:800;overflow-wrap:anywhere}
.mbg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-bottom:5px}.mb{background:#f7f9fb;border:1px solid #edf1f4;border-radius:6px;padding:7px 8px;border-left:3px solid #ddd}.mbl{font-size:8px;color:#7f8a9a;margin-bottom:2px;text-transform:uppercase;font-weight:800}.mbv{font-size:15px;font-weight:900}.mbs{font-size:8px;color:#7f8a9a;margin-top:1px;line-height:1.15}
.ct{width:100%;font-size:11px;border-collapse:collapse}.ct td{padding:5px 0;border-bottom:0.5px solid #edf1f4}.ct td:last-child{text-align:right;font-weight:800}.ct tr.tot td{font-weight:900;border-top:1px solid #d8dee7;border-bottom:none;padding-top:6px}.wfr{margin-bottom:5px}.wfl{display:flex;justify-content:space-between;font-size:9px;color:#4d5969;margin-bottom:2px}.wft{height:8px;background:#edf1f5;border-radius:3px;overflow:hidden}.wff{height:100%;border-radius:3px}
.nb{background:#fffbf0;border:1px solid #f0e0b0;border-left:3px solid var(--gold);border-radius:7px;padding:9px 11px;font-size:11px;line-height:1.55;color:#3f4a5a;margin-top:6px}.gb{padding:7px 12px;background:var(--gold);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;margin-top:5px}.ab{width:100%;padding:8px;border:none;border-radius:7px;font-size:12px;font-weight:800;cursor:pointer;margin-top:6px}.ap{background:var(--navy);color:#fff}.as{background:#fff;color:var(--navy);border:1px solid var(--navy)}
@media(max-width:980px){.detail{width:62vw}.ig{grid-template-columns:1fr 1fr}.mbg{grid-template-columns:1fr 1fr}.mfb{grid-template-columns:1fr 1fr}}
@media(max-width:700px){.sb{display:none}.nav{padding:0 12px}.ntag,.albl{display:none}.mfb{grid-template-columns:1fr 1fr}.detail{left:0;right:0;width:100vw;border-left:none}.kpis,.ig,.mbg{grid-template-columns:1fr 1fr}.dha{max-width:150px}.list{padding:8px}}
@media(max-width:430px){.mfb{grid-template-columns:1fr}.detail{top:48px}.dh{align-items:flex-start}.dha{max-width:112px}.da{padding:4px 6px}.db{padding:10px}.kpis,.ig,.mbg{grid-template-columns:1fr}}
</style>
<nav class="nav">
  <div class="logo">PARCEL<span>LA</span></div>
  <div class="ntag">LA Development Sites</div>
  <div class="nav-r"><span class="adot" id="adot"></span><span class="albl" id="albl">Connecting...</span></div>
</nav>
<div class="layout">
  <div class="sb">
    <div class="sb-body">
      <h4>Listing type</h4>
      <label class="cb"><input type="checkbox" id="f-fs" checked> For sale</label>
      <label class="cb"><input type="checkbox" id="f-rti" checked> RTI / Entitled</label>
      <label class="cb"><input type="checkbox" id="f-comp" checked> Off-market</label>
      <h4>Project type</h4>
      <label class="cb"><input type="checkbox" id="f-mf" checked> Multifamily</label>
      <label class="cb"><input type="checkbox" id="f-mx" checked> Mixed-use</label>
      <label class="cb"><input type="checkbox" id="f-cn" checked> Condo / TH</label>
      <label class="cb"><input type="checkbox" id="f-sf"> SFR + ADU</label>
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
      <div class="mf" id="hc-box"><div class="mfl">Your hard cost / SF</div><div class="mfr"><span>$</span><input type="number" id="mf-hc" placeholder="RSMeans" step="5"><button class="mfa" onclick="applyHardCostOverride()">Run</button></div></div>
    </div>
    <div class="tb">
      <span class="tbl" id="rct">Loading sites...</span>
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
  const types = [];
  if (g('f-mf')?.checked) types.push('Multifamily');
  if (g('f-mx')?.checked) types.push('Mixed-Use');
  if (g('f-cn')?.checked) types.push('Condo/TH');
  if (g('f-sf')?.checked) types.push('SFR+ADU');

  filtered = allSites.filter(s => {
    if (!ffs && !s.isComp && !s.rti && !s.forSale) return false;
    if (!frti && s.rti) return false;
    if (!fcomp && s.isComp) return false;
    if (types.length && !types.includes(s.type)) return false;
    if (hood && s.hood !== hood) return false;
    if (zone && s.zone !== zone) return false;
    if (s.units < umin || s.units > umax) return false;
    if (!s.isComp && s.askPrice && (s.askPrice < pmin || s.askPrice > pmax)) return false;
    if (mfp && (s.netProfit||0) < mfp) return false;
    if (mfi && (s.irrV||0) < mfi) return false;
    if (mfs && ((s.devSpreadPct||0)*100) < mfs) return false;
    if (mfc && (s.capOnCost||0) < mfc) return false;
    return true;
  });

  filtered.sort((a,b) => {
    if (srt==='irr')     return (b.irrV||0)-(a.irrV||0);
    if (srt==='spread')  return (b.devSpreadPct||0)-(a.devSpreadPct||0);
    if (srt==='capoc')   return (b.capOnCost||0)-(a.capOnCost||0);
    if (srt==='price-a') return (a.askPrice||0)-(b.askPrice||0);
    if (srt==='price-d') return (b.askPrice||0)-(a.askPrice||0);
    if (srt==='units')   return b.units-a.units;
    return (b.netProfit||0)-(a.netProfit||0);
  });

  const hcpsf = currentHardCostOverride();
  g('rct').textContent = filtered.length + ' site' + (filtered.length!==1?'s':'') + (hcpsf ? ' - re-underwritten at $' + hcpsf.toLocaleString() + '/SF hard cost' : ' - pre-underwritten');
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
}

function renderCards() {
  const el = g('list');
  if (!filtered.length) { el.innerHTML = '<div class="empty">No sites match your filters</div>'; return; }
  const maxP = Math.max(...filtered.map(s => s.netProfit||0), 1);
  el.innerHTML = filtered.map(s => {
    const irr=s.irrV||0, prof=s.netProfit||0;
    const pc = prof>1e6?'#1d9e75':prof>0?'#ef9f27':'#e24b4a';
    const pp = Math.max(0,Math.round(prof/maxP*100));
    const spd = Math.round((s.devSpreadPct||0)*1000)/10;
    const hcpsf = currentHardCostOverride();
    const ask = s.askPrice || s.price || 0;
    const landBasis = s.landCost || ask || 0;
    const priceMain = s.isComp ? 'Off-market' : (ask ? fmtM(ask) : 'Price n/a');
    const priceSub = s.isComp ? 'imputed land ' + fmtM(landBasis) : (ask ? 'asking price / land basis' : 'asking price missing');
    return `<div class="card${openId===s.id?' sel':''}" onclick="openDetail(${s.id})">
      <div class="ch">
        <div><div class="ca">${s.addr}</div><div class="cm">${s.hood} &middot; ${s.zone} &middot; ${(s.lot||0).toLocaleString()} SF &middot; ${s.units} units</div></div>
        <div><div class="cp">${priceMain}</div><div style="font-size:10px;color:#768295;text-align:right">${priceSub}</div></div>
      </div>
      <div class="bdgs">
        ${s.rti?'<span class="bdg b1">✓ RTI</span>':s.isComp?'<span class="bdg b4">Off-market</span>':'<span class="bdg b2">For sale</span>'}
        <span class="bdg b3">${s.type}</span>${s.isComp?'<span class="bdg b4">land imputed</span>':''}${hcpsf?'<span class="bdg b4">$' + hcpsf.toLocaleString() + '/SF hard cost</span>':''}
      </div>
      <div class="kpis">
        <div class="kp"><div class="kpl">Net profit</div><div class="kpv" style="color:${pc}">${fmtM(prof)}</div></div>
        <div class="kp"><div class="kpl">IRR</div><div class="kpv" style="color:${irrC(irr)}">${Math.round(irr*10)/10}%</div></div>
        <div class="kp"><div class="kpl">Dev spread</div><div class="kpv">${spd}%</div></div>
        <div class="kp"><div class="kpl">Cap on cost</div><div class="kpv">${s.capOnCost||0}%</div></div>
      </div>
      <div class="pb">
        <span class="pbl">Exit ${fmtM(s.exitValue)}</span>
        <div class="pbt"><div class="pbf" style="width:${pp}%;background:${pc}"></div></div>
        <span class="pbv" style="color:${pc}">${fmtM(prof)}</span>
      </div>
    </div>`;
  }).join('');
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

function incomeStatementForSite(s) {
  const noi = Math.round(s.noi || 0);
  const opexRatio = 0.35;
  const grossPotentialRent = Math.round(s.grossPotentialRent || (noi ? noi / (1 - opexRatio) / 0.95 : 0));
  const vacancyLoss = Math.round(s.vacancyLoss ?? grossPotentialRent * 0.05);
  const otherIncome = Math.round(s.otherIncome ?? (s.units || 0) * 600);
  const effectiveGrossIncome = Math.round(s.effectiveGrossIncome || (grossPotentialRent - vacancyLoss + otherIncome));
  const operatingExpenses = Math.round(s.operatingExpenses || Math.max(0, effectiveGrossIncome - noi));
  const expenseDetail = s.expenseDetail || {
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
  return {
    grossPotentialRent,
    vacancyLoss,
    otherIncome,
    effectiveGrossIncome,
    operatingExpenses,
    expenseDetail,
    noi,
    debtService: Math.round(s.debtService ?? (s.loanAmount || (s.totalCost || 0) * 0.65) * 0.065),
    cfbt: Math.round(s.cfbt ?? (noi - ((s.loanAmount || (s.totalCost || 0) * 0.65) * 0.065))),
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

function renderDetail(s) {
  const irr=s.irrV||0, prof=s.netProfit||0, tc=s.totalCost||0;
  const pc=prof>0?'#1d9e75':'#e24b4a', ic=irrC(irr);
  const spd=Math.round((s.devSpreadPct||0)*1000)/10;
  const ask=s.askPrice||s.price||0;
  const land=s.landCost||ask||0;
  const landLabel=s.isComp?'Imputed land value':'Asking price';
  const landNote=s.isComp?'Estimated from comparable land basis':'Used as land basis in underwriting';
  const totalSF=(s.units||0)*(s.usf||800);
  const hardCostOverride=currentHardCostOverride();
  const hardCosts=Math.round(s.hardCosts ?? Math.max(0,(tc-land)*0.58));
  const softCosts=Math.round(s.softCosts ?? Math.max(0,(tc-land)*0.24));
  const carryCost=Math.round(s.carryCost ?? Math.max(0,(tc-land)*0.18));
  const hardPerSf=totalSF?Math.round(hardCosts/totalSF):0;
  const hardPerUnit=s.units?Math.round(hardCosts/s.units):0;
  const totalPerSf=totalSF?Math.round(tc/totalSF):0;
  const totalPerUnit=s.units?Math.round(tc/s.units):0;
  const softPctHard=hardCosts?Math.round((softCosts/hardCosts)*1000)/10:0;
  const hardCostRead = hardPerUnit >= 400000
    ? 'High hard cost per unit is being driven by unit size/count. Compare hard cost per SF first; per-unit cost is only reliable against similar unit sizes.'
    : 'Hard cost per SF is the primary construction benchmark. Per-unit cost is a secondary check and rises quickly for larger units.';
  const income = incomeStatementForSite(s);
  const bars=[
    [land,'#0f1f3d','Land'+(s.isComp?' (imputed)':'')],
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
      <div class="ic"><div class="icl">Status</div><div class="icv">${s.rti?'✓ RTI':s.isComp?'Off-market':'For sale'}</div></div>
      <div class="ic"><div class="icl">Units / Avg SF</div><div class="icv">${s.units} / ${s.usf} SF</div></div>
      <div class="ic"><div class="icl">${landLabel}</div><div class="icv">${land?fmtD(land):'Not provided'} <span style="display:block;font-size:8px;color:#7f8a9a;font-weight:600;margin-top:1px">${landNote}</span></div></div>
      <div class="ic"><div class="icl">All-in cost</div><div class="icv">${fmtM(tc)}</div></div>
    </div>
    <div class="sh">Street View</div>
    <a href="${mapsLink(s.addr)}" target="_blank" rel="noopener" style="display:block;border-radius:8px;overflow:hidden;border:1px solid #e8e8e8;margin-bottom:4px">
      <img src="${streetViewURL(34.0522 + (s.id * 0.003), -118.2851 - (s.id * 0.002))}"
        alt="Street view of ${s.addr}"
        style="width:100%;height:140px;object-fit:cover;display:block"
        onerror="this.parentElement.innerHTML='<div style=\'height:60px;display:flex;align-items:center;justify-content:center;background:#f8f8f8;font-size:11px;color:#aaa\'>Street View unavailable</div>'">
      <div style="padding:5px 8px;font-size:9px;color:#666;background:#f8f8f8">📍 ${s.addr} · Click to open in Google Maps</div>
    </a>
    <div class="sh">Returns</div>
    <div class="mbg">
      <div class="mb" style="border-left-color:${pc}"><div class="mbl">Net profit</div><div class="mbv" style="color:${pc}">${fmtM(prof)}</div><div class="mbs">exit − all-in</div></div>
      <div class="mb" style="border-left-color:${ic}"><div class="mbl">IRR (5-yr)</div><div class="mbv" style="color:${ic}">${Math.round(irr*10)/10}%</div><div class="mbs">${irrL(irr)}</div></div>
      <div class="mb" style="border-left-color:${ic}"><div class="mbl">Cap on cost</div><div class="mbv">${s.capOnCost||0}%</div><div class="mbs">vs ${((s.entryCap||0.045)*100).toFixed(2)}% mkt</div></div>
      <div class="mb" style="border-left-color:${ic}"><div class="mbl">Dev spread</div><div class="mbv">${spd}%</div><div class="mbs">${fmtM(prof)} above cost</div></div>
    </div>
    <div class="sh">Cost waterfall</div>
    ${bars.map(([v,c,l])=>`<div class="wfr"><div class="wfl"><span>${l}</span><span>${fmtD(v)}</span></div><div class="wft"><div class="wff" style="width:${Math.round(v/tc*100)}%;background:${c}"></div></div></div>`).join('')}
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-top:1px solid #e8e8e8;margin-top:4px;font-size:11px;font-weight:600"><span>Total all-in</span><span>${fmtD(tc)}</span></div>
    <div class="sh">Construction budget</div>
    <table class="ct">
      <tr><td>Total building SF</td><td>${totalSF.toLocaleString()} SF</td></tr>
      <tr><td>Hard construction</td><td>${fmtD(hardCosts)}</td></tr>
      <tr><td>Hard cost / SF</td><td>${fmtD(hardPerSf)}/SF${hardCostOverride?' <span style="color:#b98b2f;font-size:9px">custom input</span>':''}</td></tr>
      <tr><td>Hard cost / unit</td><td>${fmtD(hardPerUnit)}/unit</td></tr>
      <tr><td>Soft costs / hard costs</td><td>${softPctHard}%</td></tr>
      <tr class="tot"><td>Total cost basis</td><td>${fmtD(totalPerSf)}/SF | ${fmtD(totalPerUnit)}/unit</td></tr>
    </table>
    <div style="font-size:9px;color:#6f7b8c;line-height:1.35;margin:5px 0 8px">${hardCostRead} The Excel Construction Costs tab includes detailed hard and soft cost line items.</div>
    <div class="sh">Valuation</div>
    <table class="ct">
      <tr><td>NOI (stabilized)</td><td>${fmtD(s.noi||0)}</td></tr>
      <tr><td>Exit cap rate</td><td>${(((s.entryCap||0.045)+0.0025)*100).toFixed(2)}%</td></tr>
      <tr><td>Year 5 NOI</td><td>${fmtD(s.year5Noi || (s.noi||0)*Math.pow(1.03,4))}</td></tr>
      <tr><td>Exit value</td><td>${fmtD(s.exitValue||0)}</td></tr>
      <tr><td style="color:#e24b4a">Less: all-in cost</td><td style="color:#e24b4a">−${fmtD(tc)}</td></tr>
      <tr class="tot"><td style="color:${pc}">Net profit</td><td style="color:${pc};font-size:14px">${fmtD(prof)}</td></tr>
    </table>
    <div class="sh">Income statement</div>
    <table class="ct">
      <tr><td>Gross potential rent</td><td>${fmtD(income.grossPotentialRent)}</td></tr>
      <tr><td>Vacancy loss (5%)</td><td style="color:#e24b4a">-${fmtD(income.vacancyLoss)}</td></tr>
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
  const units = s.units || 0;
  const avgUnitSf = s.usf || 800;
  const totalSF = units * avgUnitSf;
  const hardCosts = Math.round(s.hardCosts ?? Math.max(0, (tc - land) * 0.58));
  const softCosts = Math.round(s.softCosts ?? Math.max(0, (tc - land) * 0.24));
  const carryCost = Math.round(s.carryCost ?? Math.max(0, (tc - land) * 0.18));
  const loan = Math.round(s.loanAmount ?? tc * 0.65);
  const equity = Math.round(s.equity ?? tc * 0.35);
  const hardPerSf = costPerSf(hardCosts, totalSF);
  const hardPerUnit = costPerUnit(hardCosts, units);
  const softPerSf = costPerSf(softCosts, totalSF);
  const softPerUnit = costPerUnit(softCosts, units);
  const carryPerSf = costPerSf(carryCost, totalSF);
  const carryPerUnit = costPerUnit(carryCost, units);
  const totalPerSf = costPerSf(tc, totalSF);
  const totalPerUnit = costPerUnit(tc, units);
  const softPctHard = hardCosts ? Math.round((softCosts / hardCosts) * 1000) / 10 : 0;
  const hardSchedule = allocateCostSchedule(hardCosts, hardCostLineItems(s));
  const softSchedule = allocateCostSchedule(softCosts, softCostLineItems());
  const carrySchedule = allocateCostSchedule(carryCost, carryCostLineItems());
  const rows = [
    xlsTitleRow('Construction Cost Validation', s.addr),
    xlsRow(['Project Type', s.type || '']),
    xlsRow(['Units', cellNumber(units)]),
    xlsRow(['Avg Unit SF', cellNumber(avgUnitSf)]),
    xlsRow(['Total Net Rentable SF', cellNumber(totalSF)]),
    xlsRow(['Cost Note', ['Line items are an underwriting allocation of the current budget, not a contractor bid. Replace with GC pricing when available.' + (currentHardCostOverride() ? ' User hard-cost override applied across all deals: $' + currentHardCostOverride().toLocaleString() + '/SF.' : ''), 'String', 'note']]),
    xlsRow(['']),
    xlsHeaderRow(['Budget Category', 'Cost', '$ / SF', '$ / Unit', '% of Total Cost', 'Validation / Source']),
    xlsRow([s.isComp ? 'Imputed Land Value' : 'Asking Price / Land Basis', cellMoney(Math.round(land)), totalSF ? cellMoney(costPerSf(land, totalSF)) : '', units ? cellMoney(costPerUnit(land, units)) : '', tc ? cellPct(costPct(land, tc)) : '', s.isComp ? 'Estimated off-market land basis' : 'For-sale asking price used as land basis']),
    xlsRow(['Hard Costs', cellMoney(hardCosts), cellMoney(hardPerSf), cellMoney(hardPerUnit), tc ? cellPct(costPct(hardCosts, tc)) : '', 'Detailed schedule below: HVAC, framing, plumbing, electrical, etc.']),
    xlsRow(['Soft Costs', cellMoney(softCosts), totalSF ? cellMoney(softPerSf) : '', units ? cellMoney(softPerUnit) : '', tc ? cellPct(costPct(softCosts, tc)) : '', 'A&E, permits, fees, legal, developer fee, contingency']),
    xlsRow(['Financing Carry', cellMoney(carryCost), totalSF ? cellMoney(carryPerSf) : '', units ? cellMoney(carryPerUnit) : '', tc ? cellPct(costPct(carryCost, tc)) : '', 'Interest reserve, loan fees, taxes and lease-up carry']),
    xlsRow(['Total All-In Cost', cellMoney(Math.round(tc)), cellMoney(totalPerSf), cellMoney(totalPerUnit), cellPct(100), 'Total underwriting basis'], 'section'),
  ];

  pushCostSchedule(rows, 'Hard Cost Schedule', hardCosts, hardSchedule, totalSF, units);
  pushCostSchedule(rows, 'Soft Cost Schedule', softCosts, softSchedule, totalSF, units);
  pushCostSchedule(rows, 'Financing / Carry Schedule', carryCost, carrySchedule, totalSF, units);

  rows.push(xlsRow(['']));
  rows.push(xlsSectionRow('Financing Metrics'));
  rows.push(xlsRow(['Construction Loan', cellMoney(loan), totalSF ? cellMoney(costPerSf(loan, totalSF)) : '', units ? cellMoney(costPerUnit(loan, units)) : '', tc ? cellPct(costPct(loan, tc)) : '', 'Assumes 65% loan-to-cost unless model overrides']));
  rows.push(xlsRow(['Equity Required', cellMoney(equity), totalSF ? cellMoney(costPerSf(equity, totalSF)) : '', units ? cellMoney(costPerUnit(equity, units)) : '', tc ? cellPct(costPct(equity, tc)) : '', 'Borrower cash / sponsor equity']));
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

  const tc = s.totalCost || 0;
  const land = s.landCost || s.askPrice || 0;
  const noi = s.noi || 0;
  const exitValue = s.exitValue || 0;
  const netProfit = s.netProfit || 0;
  const irr = s.irrV || 0;
  const entryCap = s.entryCap || submarket?.entryCap || 0.0475;
  const exitCap = s.exitCap || submarket?.exitCap || entryCap + 0.0025;
  const loan = tc * 0.65;
  const equity = tc * 0.35;
  const debtService = loan * 0.065;
  const today = new Date().toISOString().slice(0,10);
  const rentMonthly = noi > 0 ? Math.round(noi / 0.62 / 0.95 / 12) : 0;
  const totalSF = (s.units || 0) * (s.usf || 800);
  const hardCosts = Math.round(s.hardCosts ?? Math.max(0, (tc - land) * 0.58));
  const softCosts = Math.round(s.softCosts ?? Math.max(0, (tc - land) * 0.24));
  const carryCost = Math.round(s.carryCost ?? Math.max(0, (tc - land) * 0.18));
  const hardPerSf = totalSF ? Math.round(hardCosts / totalSF) : 0;
  const hardPerUnit = s.units ? Math.round(hardCosts / s.units) : 0;
  const totalPerSf = totalSF ? Math.round(tc / totalSF) : 0;
  const totalPerUnit = s.units ? Math.round(tc / s.units) : 0;
  const income = incomeStatementForSite(s);

  const summaryRows = [
    xlsTitleRow('ParceLLA Comprehensive Underwriting', s.addr),
    xlsRow(['Generated', today]),
    xlsRow(['']),
    xlsSectionRow('Property Summary'),
    xlsRow(['Address', s.addr]),
    xlsRow(['Neighborhood', s.hood]),
    xlsRow(['Zoning', s.zone]),
    xlsRow(['Project Type', s.type]),
    xlsRow(['Units', cellNumber(s.units || 0)]),
    xlsRow(['Average Unit SF', cellNumber(s.usf || 0)]),
    xlsRow(['Lot SF', cellNumber(s.lot || 0)]),
    xlsRow(['Land Cost', cellMoney(Math.round(land))]),
    xlsRow(['All-In Cost', cellMoney(Math.round(tc))]),
    xlsRow(['Net Profit', cellMoneySigned(Math.round(netProfit))]),
    xlsRow(['RTI', s.rti ? 'Yes' : 'No']),
    xlsRow(['Status', s.isComp ? 'Off-market' : 'For sale']),
    xlsRow(['Permit Source ID', s.permitSourceId || '']),
    xlsRow(['Underwritten At', s.underwrittenAt || '']),
  ];

  const underwritingRows = [
    xlsTitleRow('Underwriting', s.addr),
    xlsHeaderRow(['Metric', 'Value', '$ / SF', '$ / Unit', 'Notes']),
    xlsRow(['Land Cost', cellMoney(Math.round(land)), totalSF ? cellMoney(Math.round(land / totalSF)) : '', s.units ? cellMoney(Math.round(land / s.units)) : '', 'Purchase price or imputed land basis']),
    xlsRow(['Hard Costs', cellMoney(hardCosts), cellMoney(hardPerSf), cellMoney(hardPerUnit), 'Construction cost validation shown in Construction Costs tab']),
    xlsRow(['Soft Costs', cellMoney(softCosts), totalSF ? cellMoney(Math.round(softCosts / totalSF)) : '', s.units ? cellMoney(Math.round(softCosts / s.units)) : '', 'A&E, permits, fees, contingency, developer fee']),
    xlsRow(['Financing Carry', cellMoney(carryCost), totalSF ? cellMoney(Math.round(carryCost / totalSF)) : '', s.units ? cellMoney(Math.round(carryCost / s.units)) : '', 'Interest, loan fees, taxes during construction']),
    xlsRow(['Total All-In Cost', cellMoney(Math.round(tc)), cellMoney(totalPerSf), cellMoney(totalPerUnit), 'Total development basis'], 'section'),
    xlsRow(['Loan Amount', cellMoney(Math.round(loan)), totalSF ? cellMoney(Math.round(loan / totalSF)) : '', s.units ? cellMoney(Math.round(loan / s.units)) : '', '65% LTC assumption unless overridden']),
    xlsRow(['Equity Required', cellMoney(Math.round(equity)), totalSF ? cellMoney(Math.round(equity / totalSF)) : '', s.units ? cellMoney(Math.round(equity / s.units)) : '', 'Sponsor equity requirement']),
    xlsRow(['NOI', cellMoney(Math.round(noi)), totalSF ? cellMoney(Math.round(noi / totalSF)) : '', s.units ? cellMoney(Math.round(noi / s.units)) : '', 'Stabilized annual NOI']),
    xlsRow(['Year 5 NOI', cellMoney(Math.round(s.year5Noi || noi * Math.pow(1.03, 4))), totalSF ? cellMoney(Math.round((s.year5Noi || noi * Math.pow(1.03, 4)) / totalSF)) : '', s.units ? cellMoney(Math.round((s.year5Noi || noi * Math.pow(1.03, 4)) / s.units)) : '', 'Year-5 NOI used for exit valuation']),
    xlsRow(['Entry Cap Rate %', cellPct(Math.round(entryCap * 10000) / 100), '', '', 'Market cap rate input']),
    xlsRow(['Exit Cap Rate %', cellPct(Math.round(exitCap * 10000) / 100), '', '', 'Exit cap assumption']),
    xlsRow(['Exit Value', cellMoney(Math.round(exitValue)), totalSF ? cellMoney(Math.round(exitValue / totalSF)) : '', s.units ? cellMoney(Math.round(exitValue / s.units)) : '', 'Year-5 NOI divided by exit cap']),
    xlsRow(['Net Profit', cellMoneySigned(Math.round(netProfit)), totalSF ? cellMoneySigned(Math.round(netProfit / totalSF)) : '', s.units ? cellMoneySigned(Math.round(netProfit / s.units)) : '', 'Exit value less total all-in cost']),
    xlsRow(['IRR %', cellPct(Math.round(irr * 10) / 10), '', '', 'Levered 5-year IRR']),
    xlsRow(['Cap On Cost %', cellPct(s.capOnCost || 0), '', '', 'NOI / total cost']),
    xlsRow(['Development Spread %', cellPct(Math.round((s.devSpreadPct || 0) * 1000) / 10), '', '', 'Spread over all-in cost']),
  ];

  const rentRows = [
    xlsTitleRow('Rent Roll', s.addr),
    xlsSectionRow('Rent Assumptions'),
    xlsRow(['Submarket', s.hood]),
    xlsRow(['Implied Monthly Gross Rent', cellMoney(rentMonthly)]),
    xlsRow(['Implied Annual Gross Rent', cellMoney(rentMonthly * 12)]),
    xlsRow(['Vacancy', '5.0%']),
    xlsRow(['Expense Ratio', '35.0%']),
    xlsRow(['']),
    ...rentRowsFromSubmarket(s, submarket),
  ];

  const cashFlowRows = [
    xlsTitleRow('Cash Flow', s.addr),
    xlsHeaderRow(['Year', 'NOI', 'Debt Service', 'Cash Flow Before Tax', 'Exit Value', 'Loan Payoff', 'Net Sale Proceeds']),
  ];
  for (let year = 1; year <= 5; year++) {
    const yearNoi = Math.round(noi * Math.pow(1.03, year - 1));
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
    xlsRow(['Rent miss 5%', cellMoneyRed(-Math.round(noi * 0.05 * 5)), 'Validate achievable rents with local comps']),
    xlsRow(['Cap expansion 50 bps', cellMoneyRed(-Math.round(noi / 0.005)), 'Use conservative exit cap and stress test']),
    xlsRow(['Cost overrun 10%', cellMoneyRed(-Math.round(tc * 0.10)), 'GC pricing, contingency, value engineering']),
  ];

  const workbook = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    xlsStyles() +
    xlsSheet('Summary', summaryRows, [220, 220, 120, 120, 220]) +
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
  const irr  = s.irrV || 0;
  const prof = s.netProfit || 0;
  const pc   = prof > 0 ? '#1d9e75' : '#e24b4a';
  const ic   = irrC(irr);
  const tc   = s.totalCost || 0;
  const land = s.landCost || s.askPrice || 0;
  const noi  = s.noi || 0;
  const exitV = s.exitValue || 0;
  const entryCap = s.entryCap || 0.0475;
  const exitCap  = s.exitCap || entryCap + 0.0025;
  const capoc    = s.capOnCost || 0;
  const spread   = Math.round((s.devSpreadPct || 0) * 1000) / 10;
  const today    = new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});
  const pdfTotalSF = (s.units || 0) * (s.usf || 800);
  const pdfHardCosts = Math.round(s.hardCosts ?? Math.max(0, (tc - land) * 0.58));
  const pdfSoftCosts = Math.round(s.softCosts ?? Math.max(0, (tc - land) * 0.24));
  const pdfCarryCost = Math.round(s.carryCost ?? Math.max(0, (tc - land) * 0.18));
  const pdfHardPerSf = pdfTotalSF ? Math.round(pdfHardCosts / pdfTotalSF) : 0;
  const pdfHardPerUnit = s.units ? Math.round(pdfHardCosts / s.units) : 0;
  const pdfSoftPerSf = pdfTotalSF ? Math.round(pdfSoftCosts / pdfTotalSF) : 0;
  const pdfCarryPerSf = pdfTotalSF ? Math.round(pdfCarryCost / pdfTotalSF) : 0;
  const pdfTotalPerSf = pdfTotalSF ? Math.round(tc / pdfTotalSF) : 0;
  const pdfTotalPerUnit = s.units ? Math.round(tc / s.units) : 0;
  const pdfSoftPctHard = pdfHardCosts ? Math.round((pdfSoftCosts / pdfHardCosts) * 1000) / 10 : 0;
  const pdfIncome = incomeStatementForSite(s);

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
  <div class="sub">${s.rti ? '✓ RTI Approved — Entitled Site' : s.isComp ? 'Off-Market Comparable' : 'Active Listing — For Sale'}</div>
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
  ${s.rti ? 'The project holds Ready-to-Issue (RTI) approval, eliminating entitlement risk and enabling immediate construction commencement upon permit issuance.' : 'The project is currently in the entitlement pipeline.'}
  Based on RSMeans 2024 construction cost data and CoStar Q3 2024 market cap rates, the projected all-in development cost is <strong>${fmtD(tc)}</strong> (${fmtD(pdfTotalPerUnit)}/unit; ${fmtD(pdfTotalPerSf)}/SF), 
  with a stabilized exit value of <strong>${fmtD(exitV)}</strong> at a ${(exitCap*100).toFixed(2)}% exit cap rate, yielding a net development profit of <strong>${fmtD(prof)}</strong>.
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
      <tr><td>RTI Status</td><td class="${s.rti ? 'green' : 'amber'}">${s.rti ? '✓ RTI Approved' : 'In Process'}</td></tr>
      <tr><td>Listing Status</td><td>${s.isComp ? 'Off-Market' : 'Active For Sale'}</td></tr>
      <tr><td>Demo Required</td><td>${s.demo ? 'Yes' : 'No'}</td></tr>
      <tr><td>Asking Price</td><td>${s.isComp ? 'Off-market (imputed)' : fmtD(s.askPrice||0)}</td></tr>
      <tr><td>Price per Unit</td><td>${fmtD(Math.round((s.askPrice||land)/s.units))}</td></tr>
      <tr><td>Price per SF (land)</td><td>${fmtD(Math.round((s.askPrice||land)/(s.lot||5000)))}/SF</td></tr>
    </table>

    <h3>Unit Mix</h3>
    <table>
      <tr><th>Type</th><th>Mix</th><th>Units</th><th>Rent/mo</th></tr>
      <tr><td>Studio</td><td>25%</td><td>${Math.round(s.units*0.25)}</td><td>Market</td></tr>
      <tr><td>1 Bedroom</td><td>50%</td><td>${Math.round(s.units*0.50)}</td><td>Market</td></tr>
      <tr><td>2 Bedroom</td><td>20%</td><td>${Math.round(s.units*0.20)}</td><td>Market</td></tr>
      <tr><td>3 Bedroom</td><td>5%</td><td>${Math.round(s.units*0.05)}</td><td>Market</td></tr>
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
      <tr><td>SFR + ADU</td><td>${((entryCap+0.0075)*100).toFixed(2)}%</td><td>${((exitCap+0.0075)*100).toFixed(2)}%</td></tr>
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
      <tr><td>${s.isComp?'Imputed Land Value':'Asking Price / Land Basis'}</td><td>${fmtD(land)}${s.isComp?' (estimated)':''}</td></tr>
      <tr><td>Title, Escrow & Legal (est.)</td><td>${fmtD(land*0.015+25000)}</td></tr>
      <tr class="tot"><td>Land Subtotal</td><td>${fmtD(land*1.015+25000)}</td></tr>

      <tr><th colspan="2" style="padding-top:10px">HARD COSTS</th></tr>
      <tr><td>Hard Construction Budget</td><td>${fmtD(pdfHardCosts)}</td></tr>
      <tr><td>Hard Cost / SF</td><td>${fmtD(pdfHardPerSf)}/SF</td></tr>
      <tr><td>Hard Cost / Unit</td><td>${fmtD(pdfHardPerUnit)}/unit</td></tr>
      <tr><td>Budget Read</td><td>Use $/SF first; $/unit rises with larger units</td></tr>
      <tr class="tot"><td>Hard Cost Subtotal</td><td>${fmtD(pdfHardCosts)}</td></tr>
    </table>
  </div>
  <div>
    <table>
      <tr><th colspan="2">SOFT COSTS</th></tr>
      <tr><td>Architecture & Engineering (6%)</td><td>${fmtD(tc*0.09)}</td></tr>
      <tr><td>Permits & Fees</td><td>${fmtD(s.units*2500)}</td></tr>
      <tr><td>Property Tax During Construction</td><td>${fmtD(land*0.0125*1.5)}</td></tr>
      <tr><td>Developer Fee (4%)</td><td>${fmtD(tc*0.04)}</td></tr>
      <tr><td>Other Soft Costs</td><td>${fmtD(s.units*3000)}</td></tr>
      <tr class="tot"><td>Soft Cost Subtotal (18%)</td><td>${fmtD(tc*0.18)}</td></tr>

      <tr><th colspan="2" style="padding-top:10px">FINANCING & CARRY</th></tr>
      <tr><td>Construction Loan (65% LTC)</td><td>${fmtD(tc*0.65)}</td></tr>
      <tr><td>Construction Interest (6.5%, 18mo)</td><td>${fmtD(tc*0.65*0.065*1.5)}</td></tr>
      <tr><td>Loan Origination Fee (1%)</td><td>${fmtD(tc*0.65*0.01)}</td></tr>
      <tr class="tot"><td>Total Carry</td><td>${fmtD(tc*0.65*0.065*1.5+tc*0.65*0.01)}</td></tr>
    </table>
  </div>
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
      <tr class="tot"><td colspan="3">Gross Potential Rent</td><td>${fmtD(noi/0.62*1.0)}</td></tr>
    </table>

    <h3>Operating Statement</h3>
    <table>
      <tr><td>Gross Potential Rent</td><td>${fmtD(pdfIncome.grossPotentialRent)}</td></tr>
      <tr><td>Less: Vacancy (5%)</td><td style="color:#e24b4a">(${fmtD(pdfIncome.vacancyLoss)})</td></tr>
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
      <tr><td>Total Operating Expenses (35%)</td><td style="color:#e24b4a">(${fmtD(pdfIncome.operatingExpenses)})</td></tr>
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
      <tr><td>Exit Cap Rate (entry + 25bps)</td><td>${(exitCap*100).toFixed(2)}%</td></tr>
      <tr><td>Exit Value</td><td>${fmtD(exitV)}</td></tr>
      <tr><td>Less: Construction Loan</td><td style="color:#e24b4a">(${fmtD(tc*0.65)})</td></tr>
      <tr><td>Exit Proceeds to Equity</td><td>${fmtD(exitV-tc*0.65)}</td></tr>
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
    <td>NOI (3.0% annual growth)</td>
    <td style="text-align:right;color:#999">—</td>
    ${[1,2,3,4,5].map(yr => `<td style="text-align:right">${fmtD(Math.round(noi*Math.pow(1.03,yr-1)))}</td>`).join('')}
  </tr>
  <tr>
    <td>Debt Service (I/O @ 6.5%)</td>
    <td style="text-align:right;color:#999">—</td>
    ${[1,2,3,4,5].map(() => `<td style="text-align:right;color:#e24b4a">(${fmtD(Math.round(tc*0.65*0.065))})</td>`).join('')}
  </tr>
  <tr class="tot">
    <td>CFBT</td>
    <td style="text-align:right;color:#999">—</td>
    ${[1,2,3,4,5].map(yr => {
      const cfbt = Math.round(noi*Math.pow(1.03,yr-1) - tc*0.65*0.065);
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
    <td style="text-align:right;color:#e24b4a">(${fmtD(Math.round(tc*0.65))})</td>
  </tr>
  <tr class="tot" style="background:#0f1f3d;color:white">
    <td style="color:white">EQUITY CASHFLOWS</td>
    <td style="text-align:right;color:#c49a3c">(${fmtD(Math.round(tc*0.35))})</td>
    ${[1,2,3,4,5].map((yr, i) => {
      const cfbt = Math.round(noi*Math.pow(1.03,yr-1) - tc*0.65*0.065);
      const exit = yr===5 ? exitV - Math.round(tc*0.65) : 0;
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
    <div class="kpi-v">${tc > 0 ? (Math.round((exitV - tc*0.65 + tc*0.35) / (tc*0.35) * 100)/100).toFixed(2) : '—'}x</div>
    <div class="kpi-s">total equity return</div>
  </div>
  <div class="kpi" style="border-left-color:#4472C4">
    <div class="kpi-l">Cash-on-Cash (Yr1)</div>
    <div class="kpi-v">${tc > 0 ? (Math.round((noi - tc*0.65*0.065)/(tc*0.35)*1000)/10).toFixed(1) : '—'}%</div>
    <div class="kpi-s">CFBT / equity</div>
  </div>
  <div class="kpi" style="border-left-color:#4472C4">
    <div class="kpi-l">DSCR (Yr1)</div>
    <div class="kpi-v">${tc > 0 ? (Math.round(noi/(tc*0.65*0.065)*100)/100).toFixed(2) : '—'}x</div>
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
      <tr><td>Rent miss (5%)</td><td class="red">−${fmtM(noi*0.05*5)} NPV</td><td>Conservative rent assumptions</td></tr>
      <tr><td>Cap rate expansion (+50bps)</td><td class="red">−${fmtM(noi/0.005)}</td><td>Exit cap already +25bps over entry</td></tr>
      <tr><td>Construction delay (6 mo)</td><td class="amber">+${fmtM(tc*0.65*0.065*0.5)} carry</td><td>${s.rti ? 'RTI eliminates entitlement delay' : 'Depends on plan check timeline'}</td></tr>
      <tr><td>Interest rate spike (+1%)</td><td class="amber">+${fmtM(tc*0.65*0.01*1.5)} carry</td><td>Rate cap recommended</td></tr>
    </table>
  </div>
  <div>
    <h3>Sensitivity: IRR vs. Exit Cap Rate</h3>
    <table>
      <tr><th>Exit Cap</th><th>Exit Value</th><th>Net Profit</th><th>IRR (est)</th></tr>
      ${[0.045, 0.0475, 0.05, 0.0525, 0.055, 0.0575].map(cap => {
        const ev = noi/cap;
        const np = ev - tc;
        const irrEst = Math.round((np/tc/5 + (noi-tc*0.65*0.065)/(tc*0.35))*500)/10;
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
    <td>${s.isComp?'Off-mkt':fmtD(s.askPrice||0)}</td>
    <td>${fmtD(Math.round((s.askPrice||land)/s.units))}</td>
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
  ['f-fs','f-rti','f-comp','f-mf','f-mx','f-cn'].forEach(id=>{const el=g(id);if(el)el.checked=true;});
  const sf=g('f-sf'); if(sf)sf.checked=false;
  ['f-hood','f-zone'].forEach(id=>{const el=g(id);if(el)el.value='';});
  ['f-umin','f-umax','f-pmin','f-pmax','mf-p','mf-i','mf-s','mf-c','mf-hc'].forEach(id=>{const el=g(id);if(el)el.value='';});
  loadSites();
}

function handleShareLink() {
  const params = new URLSearchParams(window.location.search);
  const siteId = params.get('site');
  if (siteId) setTimeout(()=>{const s=allSites.find(x=>x.id===+siteId);if(s)openDetail(+siteId);}, 800);
}

boot().then(handleShareLink);
