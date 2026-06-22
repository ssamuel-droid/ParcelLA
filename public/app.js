// ParceLLA — Frontend
const API = 'https://parcella-api-production.up.railway.app';
const GMAPS_KEY = 'AIzaSyAC7R0Wlh41L71vexWCYqdn3WAjx8PJeQ0';

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
    if (!ffs && !s.isComp && !s.rti) return false;
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
    <div class="sh">AI deal analysis <span style="font-size:8px;color:#bbb;font-weight:400">powered by Claude</span></div>
    <div id="narr-${s.id}"><button class="gb" onclick="generateNarrative(${s.id})">Generate analysis →</button></div>
    <button class="ab as" onclick="shareDeal()">⤴ Copy share link</button>
    <button class="ab ap" onclick="exportPDF(${s.id})">↓ Download PDF deal memo</button>`;
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

async function exportPDF(id) {
  if (!id) return;
  try {
    const r = await fetch(API+'/api/pdf/'+id, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({overrides:{}})
    });
    if (!r.ok) throw new Error('PDF failed');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const s = allSites.find(x=>x.id===id);
    a.href=url; a.download='ParceLLA_'+(s?.addr||id).replace(/\s+/g,'_')+'.pdf'; a.click();
    URL.revokeObjectURL(url);
  } catch(e) { alert('PDF: '+e.message); }
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
