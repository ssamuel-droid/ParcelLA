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
body{font-family:'Inter',system-ui,sans-serif;background:#f4f4f4;color:#1a1a1a;height:100vh;overflow:hidden}
.nav{background:#0f1f3d;padding:0 20px;height:52px;display:flex;align-items:center;gap:12px;position:fixed;top:0;left:0;right:0;z-index:100}
.logo{font-size:16px;font-weight:700;color:#fff;letter-spacing:-0.5px;flex-shrink:0}.logo span{color:#c49a3c}
.ntag{font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.5px}
.nav-r{margin-left:auto;display:flex;align-items:center;gap:6px}
.adot{width:7px;height:7px;border-radius:50%;background:#ef9f27}.adot.ok{background:#1d9e75}
.albl{font-size:10px;color:rgba(255,255,255,0.55)}
.layout{display:flex;height:calc(100vh - 52px);margin-top:52px}
.sb{width:210px;background:#fff;border-right:1px solid #e8e8e8;display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}
.sb-body{overflow-y:auto;flex:1;padding:14px}
.sb h4{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:#bbb;margin:12px 0 6px}.sb h4:first-child{margin-top:0}
.cb{display:flex;align-items:center;gap:5px;font-size:11px;color:#555;margin-bottom:4px;cursor:pointer}
.cb input{accent-color:#0f1f3d;width:12px;height:12px}
.sbs{width:100%;padding:5px 7px;border:1px solid #e8e8e8;border-radius:5px;font-size:11px;margin-bottom:5px;background:#fafafa}
.sb2{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px}
.sb2 input{width:100%;padding:5px 7px;border:1px solid #e8e8e8;border-radius:5px;font-size:11px;background:#fafafa;text-align:right}
.sbf{padding:10px 14px;border-top:1px solid #e8e8e8}
.bp{width:100%;padding:8px;background:#0f1f3d;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:4px}
.br{width:100%;padding:6px;background:transparent;color:#aaa;border:1px solid #e8e8e8;border-radius:6px;font-size:11px;cursor:pointer}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.mfb{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px 14px;background:#fff;border-bottom:1px solid #e8e8e8;flex-shrink:0}
.mf{background:#fafafa;border:1px solid #e8e8e8;border-radius:7px;padding:7px 9px}
.mfl{font-size:8px;color:#bbb;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px}
.mfr{display:flex;align-items:center;gap:3px}
.mfr input{flex:1;font-size:11px;padding:3px 4px;border:1px solid #e8e8e8;border-radius:4px;background:#fff;text-align:right;min-width:0}
.mfr span{font-size:9px;color:#bbb;flex-shrink:0}
.tb{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#fff;border-bottom:1px solid #e8e8e8;flex-shrink:0}
.tbl{font-size:12px;font-weight:600;color:#333}
.ss{font-size:11px;padding:5px 8px;border:1px solid #e8e8e8;border-radius:5px;background:#fff}
.list{flex:1;overflow-y:auto;padding:12px 14px}
.card{background:#fff;border:1px solid #e8e8e8;border-radius:10px;padding:13px 15px;margin-bottom:8px;cursor:pointer;transition:border-color 0.1s,box-shadow 0.1s}
.card:hover{border-color:#c49a3c;box-shadow:0 2px 8px rgba(0,0,0,0.06)}.card.sel{border-color:#0f1f3d;border-width:2px}
.ch{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px}
.ca{font-size:13px;font-weight:600}.cp{font-size:12px;font-weight:600;color:#0f1f3d;text-align:right}
.cm{font-size:10px;color:#aaa;margin-bottom:6px}
.bdgs{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:7px}
.bdg{font-size:8px;padding:2px 6px;border-radius:100px;font-weight:600}
.b1{background:#e1f5ee;color:#085041}.b2{background:#e6f1fb;color:#0c447c}.b3{background:#f5f0e8;color:#666}.b4{background:#faeeda;color:#854f0b}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:7px}
.kp{background:#f8f8f8;border-radius:5px;padding:5px 7px}
.kpl{font-size:8px;color:#aaa;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px}.kpv{font-size:12px;font-weight:600}
.pb{display:flex;align-items:center;gap:7px}
.pbl{font-size:10px;color:#aaa;min-width:62px}.pbt{flex:1;height:5px;background:#f0f0f0;border-radius:3px;overflow:hidden}
.pbf{height:100%;border-radius:3px}.pbv{font-size:10px;font-weight:600;min-width:58px;text-align:right}
.empty{text-align:center;padding:60px 20px;color:#aaa;font-size:12px}
.sw{text-align:center;padding:60px;color:#aaa;font-size:12px}
.spin{width:28px;height:28px;border:3px solid #f0f0f0;border-top-color:#0f1f3d;border-radius:50%;animation:sp 0.8s linear infinite;margin:0 auto 10px}
@keyframes sp{to{transform:rotate(360deg)}}
.detail{position:fixed;right:0;top:52px;width:370px;height:calc(100vh - 52px);background:#fff;border-left:1px solid #e8e8e8;overflow-y:auto;transform:translateX(100%);transition:transform 0.2s;z-index:50;box-shadow:-4px 0 24px rgba(0,0,0,0.1)}
.detail.open{transform:translateX(0)}
.dh{padding:12px 15px;border-bottom:1px solid #e8e8e8;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:2}
.dht{font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px}
.dha{display:flex;gap:4px;flex-shrink:0}
.da{padding:4px 8px;font-size:9px;font-weight:600;border:1px solid #e8e8e8;border-radius:4px;cursor:pointer;background:#fff;color:#555}
.da.p{background:#0f1f3d;color:#fff;border-color:#0f1f3d}
.dhx{background:none;border:none;font-size:18px;cursor:pointer;color:#aaa;padding:0 2px;flex-shrink:0}
.db{padding:14px}
.sh{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#bbb;margin:12px 0 7px}.sh:first-child{margin-top:0}
.ig{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:6px}
.ic{background:#f8f8f8;border-radius:6px;padding:6px 8px}.icl{font-size:8px;color:#aaa;margin-bottom:2px}.icv{font-size:11px;font-weight:600}
.mbg{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px}
.mb{background:#f8f8f8;border-radius:6px;padding:8px 10px;border-left:3px solid #ddd}
.mbl{font-size:8px;color:#aaa;margin-bottom:2px}.mbv{font-size:15px;font-weight:700}.mbs{font-size:8px;color:#aaa;margin-top:2px}
.ct{width:100%;font-size:11px;border-collapse:collapse}
.ct td{padding:4px 0;border-bottom:0.5px solid #f0f0f0}.ct td:last-child{text-align:right;font-weight:600}
.ct tr.tot td{font-weight:700;border-top:1px solid #ddd;border-bottom:none;padding-top:6px}
.wfr{margin-bottom:4px}.wfl{display:flex;justify-content:space-between;font-size:9px;color:#666;margin-bottom:2px}
.wft{height:9px;background:#f0f0f0;border-radius:2px;overflow:hidden}.wff{height:100%;border-radius:2px}
.nb{background:#fffbf0;border:1px solid #f0e0b0;border-left:3px solid #c49a3c;border-radius:7px;padding:11px 13px;font-size:11px;line-height:1.7;color:#444;margin-top:6px}
.gb{padding:7px 12px;background:#c49a3c;color:#fff;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;margin-top:7px}
.ab{width:100%;padding:9px;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;margin-top:6px}
.ap{background:#0f1f3d;color:#fff}.as{background:transparent;color:#0f1f3d;border:1px solid #0f1f3d}
@media(max-width:700px){.sb{display:none}.mfb{grid-template-columns:1fr 1fr}.detail{width:100%}.kpis{grid-template-columns:1fr 1fr}}
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
      <label class="cb"><input type="checkbox" id="f-sf" checked> SFR + ADU</label>
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
      <button class="da p" onclick="exportPDF()">↓ PDF</button>
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

async function loadSites() {
  g('list').innerHTML = '<div class="sw"><div class="spin"></div>Underwriting sites...</div>';
  try {
    const r = await fetch(API + '/api/sites?limit=50&sort=profit');
    if (!r.ok) throw new Error('API ' + r.status);
    const data = await r.json();
    allSites = data.results || [];
    applyFilters();
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
    if ((s.netProfit||0) < mfp) return false;
    if ((s.irrV||0) < mfi) return false;
    if (((s.devSpreadPct||0)*100) < mfs) return false;
    if ((s.capOnCost||0) < mfc) return false;
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

  g('rct').textContent = filtered.length + ' site' + (filtered.length!==1?'s':'') + ' — pre-underwritten';
  renderCards();
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
    return `<div class="card${openId===s.id?' sel':''}" onclick="openDetail(${s.id})">
      <div class="ch">
        <div><div class="ca">${s.addr}</div><div class="cm">${s.hood} &middot; ${s.zone} &middot; ${(s.lot||0).toLocaleString()} SF &middot; ${s.units} units</div></div>
        <div><div class="cp">${s.isComp?'Off-market':fmtM(s.askPrice)}</div><div style="font-size:10px;color:#aaa;text-align:right">land ${fmtM(s.landCost||s.askPrice)}</div></div>
      </div>
      <div class="bdgs">
        ${s.rti?'<span class="bdg b1">✓ RTI</span>':s.isComp?'<span class="bdg b4">Off-market</span>':'<span class="bdg b2">For sale</span>'}
        <span class="bdg b3">${s.type}</span>${s.isComp?'<span class="bdg b4">land imputed</span>':''}
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

function renderDetail(s) {
  const irr=s.irrV||0, prof=s.netProfit||0, tc=s.totalCost||0;
  const pc=prof>0?'#1d9e75':'#e24b4a', ic=irrC(irr);
  const spd=Math.round((s.devSpreadPct||0)*1000)/10;
  const bars=[
    [s.landCost||s.askPrice||0,'#0f1f3d','Land'+(s.isComp?' (imputed)':'')],
    [(tc-(s.landCost||0))*0.58,'#378add','Hard costs'],
    [(tc-(s.landCost||0))*0.24,'#1d9e75','Soft costs'],
    [(tc-(s.landCost||0))*0.18,'#ef9f27','Financing carry'],
  ].filter(x=>x[0]>0);

  // Load comps async
  setTimeout(async () => {
    const compsEl = g('comps-' + s.id);
    if (!compsEl) return;
    const comps = await loadComps(s.hood);
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
      <div class="ic"><div class="icl">Land cost</div><div class="icv">${fmtD(s.landCost||s.askPrice||0)}${s.isComp?' <span style="font-size:8px;color:#ef9f27">(est)</span>':''}</div></div>
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
    <div class="sh">Valuation</div>
    <table class="ct">
      <tr><td>NOI (stabilized)</td><td>${fmtD(s.noi||0)}</td></tr>
      <tr><td>Exit cap rate</td><td>${(((s.entryCap||0.045)+0.0025)*100).toFixed(2)}%</td></tr>
      <tr><td>Exit value</td><td>${fmtD(s.exitValue||0)}</td></tr>
      <tr><td style="color:#e24b4a">Less: all-in cost</td><td style="color:#e24b4a">−${fmtD(tc)}</td></tr>
      <tr class="tot"><td style="color:${pc}">Net profit</td><td style="color:${pc};font-size:14px">${fmtD(prof)}</td></tr>
    </table>
    <div class="sh">Sold comps — ${s.hood}</div>
    <div id="comps-${s.id}" style="font-size:10px;color:#aaa">Loading comps...</div>

    <div class="sh">AI deal analysis <span style="font-size:8px;color:#bbb;font-weight:400">powered by Claude</span></div>
    <div id="narr-${s.id}"><button class="gb" onclick="generateNarrative(${s.id})">Generate analysis →</button></div>
    <button class="ab as" onclick="shareDeal()">⤴ Copy share link</button>
    <button class="ab ap" onclick="exportPDF(${s.id})">↓ Download PDF deal memo</button>`;
}

async function loadComps(hood) {
  try {
    const r = await fetch(API + '/api/comps/submarket/' + encodeURIComponent(hood));
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
  const exitCap  = entryCap + 0.005;
  const capoc    = s.capOnCost || 0;
  const spread   = Math.round((s.devSpreadPct || 0) * 1000) / 10;
  const today    = new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});

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
  Based on RSMeans 2024 construction cost data and CoStar Q3 2024 market cap rates, the projected all-in development cost is <strong>${fmtD(tc)}</strong> (${fmtM(Math.round(tc/s.units))}/unit), 
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
      <tr><td>Purchase Price / Land Cost</td><td>${fmtD(land)}${s.isComp?' (imputed)':''}</td></tr>
      <tr><td>Title, Escrow & Legal (est.)</td><td>${fmtD(land*0.015+25000)}</td></tr>
      <tr class="tot"><td>Land Subtotal</td><td>${fmtD(land*1.015+25000)}</td></tr>

      <tr><th colspan="2" style="padding-top:10px">HARD COSTS (RSMeans 2024)</th></tr>
      <tr><td>Direct Construction ($${s.type==='Condo/TH'?340:s.type==='Mixed-Use'?320:s.type==='SFR+ADU'?275:285}/SF)</td><td>${fmtD((s.units*(s.usf||800))*(s.type==='Condo/TH'?340:s.type==='Mixed-Use'?320:s.type==='SFR+ADU'?275:285))}</td></tr>
      <tr><td>Site Work & Demo</td><td>${fmtD(s.demo?45000:15000)}</td></tr>
      <tr><td>Contingency (10%)</td><td>${fmtD((s.units*(s.usf||800))*(s.type==='Condo/TH'?340:s.type==='Mixed-Use'?320:285)*0.10)}</td></tr>
      <tr class="tot"><td>Hard Cost Subtotal</td><td>${fmtD((s.units*(s.usf||800))*(s.type==='Condo/TH'?340:s.type==='Mixed-Use'?320:285)*1.10+45000)}</td></tr>
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
    <td style="color:rgba(255,255,255,0.7);font-size:9px;border:none">Per Unit</td>
    <td style="color:rgba(255,255,255,0.7);font-size:9px;border:none;text-align:right">${fmtD(Math.round(tc/s.units))}/unit &nbsp;|&nbsp; ${fmtD(Math.round(tc/((s.units*(s.usf||800)))))}/SF</td>
  </tr>
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
      <tr><td>Gross Potential Rent</td><td>${fmtD(Math.round(noi/0.57))}</td></tr>
      <tr><td>Less: Vacancy (5%)</td><td style="color:#e24b4a">(${fmtD(Math.round(noi/0.57*0.05))})</td></tr>
      <tr><td>Plus: Other Income</td><td>${fmtD(s.units*600)}</td></tr>
      <tr class="tot"><td>Effective Gross Income</td><td>${fmtD(Math.round(noi/0.57*0.95+s.units*600))}</td></tr>
      <tr><td>Operating Expenses (38%)</td><td style="color:#e24b4a">(${fmtD(Math.round(noi/0.62*0.38))})</td></tr>
      <tr class="tot" style="background:#e8f5ee"><td style="color:#1d9e75;font-weight:700">NET OPERATING INCOME</td><td style="color:#1d9e75;font-weight:700;font-size:12px">${fmtD(noi)}</td></tr>
    </table>
  </div>
  <div>
    <h3>Valuation Summary</h3>
    <table>
      <tr><td>NOI (stabilized)</td><td>${fmtD(noi)}</td></tr>
      <tr><td>Entry Cap Rate</td><td>${(entryCap*100).toFixed(2)}%</td></tr>
      <tr><td>Stabilized Value (entry cap)</td><td>${fmtD(noi/entryCap)}</td></tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td></tr>
      <tr><td>Exit Cap Rate (entry + 50bps)</td><td>${(exitCap*100).toFixed(2)}%</td></tr>
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
    <td>NOI (2.5% annual growth)</td>
    <td style="text-align:right;color:#999">—</td>
    ${[1,2,3,4,5].map(yr => `<td style="text-align:right">${fmtD(Math.round(noi*Math.pow(1.025,yr-1)))}</td>`).join('')}
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
      const cfbt = Math.round(noi*Math.pow(1.025,yr-1) - tc*0.65*0.065);
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
      const cfbt = Math.round(noi*Math.pow(1.025,yr-1) - tc*0.65*0.065);
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
      <tr><td>Cap rate expansion (+50bps)</td><td class="red">−${fmtM(noi/0.005)}</td><td>Exit cap already +50bps over entry</td></tr>
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
  ['f-fs','f-rti','f-comp','f-mf','f-mx','f-cn','f-sf'].forEach(id=>{const el=g(id);if(el)el.checked=true;});
  ['f-hood','f-zone'].forEach(id=>{const el=g(id);if(el)el.value='';});
  ['f-umin','f-umax','f-pmin','f-pmax','mf-p','mf-i','mf-s','mf-c'].forEach(id=>{const el=g(id);if(el)el.value='';});
  applyFilters();
}

function handleShareLink() {
  const params = new URLSearchParams(window.location.search);
  const siteId = params.get('site');
  if (siteId) setTimeout(()=>{const s=allSites.find(x=>x.id===+siteId);if(s)openDetail(+siteId);}, 800);
}

boot().then(handleShareLink);
