// ParceLLA — Underwriting Engine
const https = require('https');

const SB_URL = process.env.SUPABASE_URL.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(SB_URL + path);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      timeout: 30000,  // 30 second timeout
      headers: {
        'Authorization': 'Bearer ' + SB_KEY,
        'apikey': SB_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const r = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, data: d }); }
      });
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('Request timeout')); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const RENTS = {
  'Silver Lake': {s:2600,o:3400,t:4400,th:5800}, 'Los Feliz': {s:2800,o:3600,t:4700,th:6200},
  'Echo Park': {s:2400,o:3100,t:4000,th:5300}, 'Atwater Village': {s:2400,o:3100,t:4000,th:5300},
  'Eagle Rock': {s:2200,o:2800,t:3650,th:4800}, 'Highland Park': {s:2200,o:2850,t:3700,th:4900},
  'Glassell Park': {s:2100,o:2700,t:3500,th:4600}, 'Mount Washington': {s:2100,o:2700,t:3500,th:4600},
  'Lincoln Heights': {s:1900,o:2400,t:3100,th:4100}, 'Boyle Heights': {s:1900,o:2450,t:3200,th:4200},
  'El Sereno': {s:1850,o:2350,t:3000,th:3950}, 'Koreatown': {s:2100,o:2700,t:3500,th:4600},
  'Mid-Wilshire': {s:2500,o:3200,t:4100,th:5400}, 'Hancock Park': {s:2600,o:3300,t:4300,th:5700},
  'Hollywood': {s:2300,o:2950,t:3800,th:5000}, 'Hollywood Hills': {s:2800,o:3600,t:4700,th:6200},
  'East Hollywood': {s:2200,o:2800,t:3600,th:4800}, 'Studio City': {s:2400,o:3100,t:4000,th:5300},
  'Sherman Oaks': {s:2200,o:2800,t:3650,th:4800}, 'Encino': {s:2200,o:2800,t:3650,th:4800},
  'West Adams': {s:2300,o:2950,t:3800,th:5000}, 'Leimert Park': {s:2000,o:2550,t:3300,th:4350},
  'Culver City': {s:2900,o:3700,t:4800,th:6300}, 'Mar Vista': {s:2700,o:3500,t:4500,th:5900},
  'Venice': {s:2900,o:3700,t:4800,th:6300}, 'West LA': {s:2600,o:3300,t:4300,th:5600},
  'Brentwood': {s:2900,o:3800,t:4900,th:6400}, 'Pacific Palisades': {s:3200,o:4100,t:5300,th:7000},
  'Van Nuys': {s:1700,o:2150,t:2800,th:3700}, 'North Hollywood': {s:1900,o:2400,t:3100,th:4100},
  'Woodland Hills': {s:2000,o:2550,t:3300,th:4350}, 'Reseda': {s:1650,o:2100,t:2700,th:3550},
  'Panorama City': {s:1600,o:2050,t:2650,th:3500}, 'Pacoima': {s:1550,o:1950,t:2550,th:3350},
  'Granada Hills': {s:1800,o:2300,t:2950,th:3900}, 'Northridge': {s:1750,o:2200,t:2850,th:3750},
  'Chatsworth': {s:1900,o:2400,t:3100,th:4100},
};
const CAPS = {
  'Venice':0.0425,'Pacific Palisades':0.0400,'Brentwood':0.0425,'Playa Vista':0.0425,
  'Silver Lake':0.0475,'Los Feliz':0.0475,'Hollywood Hills':0.0475,'Culver City':0.0450,
  'West LA':0.0450,'Mar Vista':0.0475,'Studio City':0.0475,'Hancock Park':0.0475,
  'Echo Park':0.0500,'Atwater Village':0.0500,'Mid-Wilshire':0.0500,'Hollywood':0.0500,
  'Sherman Oaks':0.0500,'Encino':0.0500,'East Hollywood':0.0525,'Highland Park':0.0525,
  'Eagle Rock':0.0500,'Glassell Park':0.0525,'Mount Washington':0.0525,'Koreatown':0.0525,
  'West Adams':0.0525,'Lincoln Heights':0.0550,'North Hollywood':0.0525,'Woodland Hills':0.0525,
  'Granada Hills':0.0525,'Northridge':0.0550,'Leimert Park':0.0550,'El Sereno':0.0575,
  'Boyle Heights':0.0575,'Van Nuys':0.0550,'Reseda':0.0575,'Canoga Park':0.0575,
  'Panorama City':0.0600,'Pacoima':0.0625,'Chatsworth':0.0525,
};
const HC = {'Multifamily':285,'Mixed-Use':320,'Condo/TH':340,'SFR+ADU':275};

const BOXES = [
  {h:'Silver Lake',lat0:34.070,lat1:34.105,lng0:-118.290,lng1:-118.250},
  {h:'Echo Park',lat0:34.060,lat1:34.085,lng0:-118.280,lng1:-118.248},
  {h:'Los Feliz',lat0:34.095,lat1:34.125,lng0:-118.310,lng1:-118.270},
  {h:'Highland Park',lat0:34.095,lat1:34.135,lng0:-118.235,lng1:-118.175},
  {h:'Eagle Rock',lat0:34.125,lat1:34.155,lng0:-118.225,lng1:-118.185},
  {h:'Atwater Village',lat0:34.110,lat1:34.130,lng0:-118.275,lng1:-118.250},
  {h:'Glassell Park',lat0:34.095,lat1:34.120,lng0:-118.255,lng1:-118.225},
  {h:'Mount Washington',lat0:34.095,lat1:34.120,lng0:-118.220,lng1:-118.195},
  {h:'Boyle Heights',lat0:34.020,lat1:34.060,lng0:-118.225,lng1:-118.190},
  {h:'El Sereno',lat0:34.065,lat1:34.095,lng0:-118.190,lng1:-118.155},
  {h:'Lincoln Heights',lat0:34.060,lat1:34.090,lng0:-118.225,lng1:-118.200},
  {h:'Koreatown',lat0:34.045,lat1:34.075,lng0:-118.325,lng1:-118.285},
  {h:'Mid-Wilshire',lat0:34.055,lat1:34.075,lng0:-118.365,lng1:-118.325},
  {h:'Hancock Park',lat0:34.070,lat1:34.090,lng0:-118.355,lng1:-118.325},
  {h:'Hollywood',lat0:34.085,lat1:34.110,lng0:-118.340,lng1:-118.300},
  {h:'East Hollywood',lat0:34.085,lat1:34.105,lng0:-118.300,lng1:-118.275},
  {h:'Hollywood Hills',lat0:34.105,lat1:34.145,lng0:-118.360,lng1:-118.300},
  {h:'West Adams',lat0:34.000,lat1:34.035,lng0:-118.355,lng1:-118.315},
  {h:'Leimert Park',lat0:33.990,lat1:34.015,lng0:-118.335,lng1:-118.310},
  {h:'Culver City',lat0:33.995,lat1:34.030,lng0:-118.420,lng1:-118.375},
  {h:'Mar Vista',lat0:33.982,lat1:34.010,lng0:-118.455,lng1:-118.415},
  {h:'Venice',lat0:33.975,lat1:34.005,lng0:-118.480,lng1:-118.445},
  {h:'West LA',lat0:34.030,lat1:34.060,lng0:-118.455,lng1:-118.420},
  {h:'Brentwood',lat0:34.040,lat1:34.075,lng0:-118.490,lng1:-118.450},
  {h:'Pacific Palisades',lat0:34.030,lat1:34.080,lng0:-118.545,lng1:-118.490},
  {h:'Studio City',lat0:34.130,lat1:34.160,lng0:-118.405,lng1:-118.370},
  {h:'Sherman Oaks',lat0:34.140,lat1:34.175,lng0:-118.465,lng1:-118.415},
  {h:'Van Nuys',lat0:34.175,lat1:34.215,lng0:-118.465,lng1:-118.415},
  {h:'North Hollywood',lat0:34.155,lat1:34.195,lng0:-118.390,lng1:-118.350},
  {h:'Encino',lat0:34.145,lat1:34.180,lng0:-118.530,lng1:-118.480},
  {h:'Woodland Hills',lat0:34.155,lat1:34.200,lng0:-118.640,lng1:-118.580},
  {h:'Reseda',lat0:34.190,lat1:34.225,lng0:-118.545,lng1:-118.500},
  {h:'Northridge',lat0:34.220,lat1:34.260,lng0:-118.555,lng1:-118.500},
  {h:'Granada Hills',lat0:34.260,lat1:34.300,lng0:-118.540,lng1:-118.490},
  {h:'Chatsworth',lat0:34.240,lat1:34.280,lng0:-118.620,lng1:-118.565},
  {h:'Panorama City',lat0:34.210,lat1:34.240,lng0:-118.455,lng1:-118.415},
  {h:'Pacoima',lat0:34.240,lat1:34.280,lng0:-118.410,lng1:-118.370},
];

function hood(lat, lng, addr) {
  if (lat && lng) {
    for (const b of BOXES) {
      if (lat>=b.lat0 && lat<=b.lat1 && lng>=b.lng0 && lng<=b.lng1) return b.h;
    }
  }
  const a = (addr||'').toUpperCase();
  if (a.includes('SILVER LAKE')||a.includes('SILVERLAKE')) return 'Silver Lake';
  if (a.includes('ECHO PARK')) return 'Echo Park';
  if (a.includes('LOS FELIZ')) return 'Los Feliz';
  if (a.includes('HIGHLAND PARK')) return 'Highland Park';
  if (a.includes('CULVER')) return 'Culver City';
  if (a.includes('MAR VISTA')) return 'Mar Vista';
  if (a.includes('WEST ADAMS')) return 'West Adams';
  if (a.includes('BOYLE')) return 'Boyle Heights';
  if (a.includes('WILSHIRE')) return 'Mid-Wilshire';
  if (a.includes('VENICE')) return 'Venice';
  if (a.includes('STUDIO CITY')) return 'Studio City';
  if (a.includes('SHERMAN OAKS')) return 'Sherman Oaks';
  if (a.includes('VAN NUYS')) return 'Van Nuys';
  if (a.includes('NORTH HOLLYWOOD')||a.includes('NO. HOLLYWOOD')) return 'North Hollywood';
  if (a.includes('WOODLAND HILLS')) return 'Woodland Hills';
  if (a.includes('RESEDA')) return 'Reseda';
  if (a.includes('NORTHRIDGE')) return 'Northridge';
  if (a.includes('GRANADA HILLS')) return 'Granada Hills';
  if (a.includes('CANOGA PARK')) return 'Canoga Park';
  if (a.includes('CHATSWORTH')) return 'Chatsworth';
  if (a.includes('PANORAMA CITY')) return 'Panorama City';
  if (a.includes('PACOIMA')) return 'Pacoima';
  return 'Koreatown';
}

function ptype(pt, st, u) {
  const s = (st||'').toLowerCase();
  if (s.includes('condo')||s.includes('townhouse')) return 'Condo/TH';
  if (s.includes('commercial')||s.includes('mixed')) return 'Mixed-Use';
  if (u>=5) return 'Multifamily';
  return 'SFR+ADU';
}

function irr(cfs) {
  let r=0.15;
  for(let i=0;i<60;i++){
    let n=0,d=0;
    for(let t=0;t<cfs.length;t++){n+=cfs[t]/Math.pow(1+r,t);d-=t*cfs[t]/Math.pow(1+r,t+1);}
    const delta=n/d; r-=delta;
    if(Math.abs(delta)<0.00001)break;
  }
  return Math.round(r*1000)/10;
}

function uw(p) {
  const h = hood(p.lat, p.lng, p.address);
  const t = ptype(p.permit_type, p.permit_subtype, p.units);
  const u = Math.max(p.units||2,2);
  const R = RENTS[h]||RENTS['Koreatown'];
  const cap = CAPS[h]||0.0525;
  const hc = HC[t]||285;
  const blend = R.s*0.25+R.o*0.50+R.t*0.20+R.th*0.05;
  const noi = blend*12*u*0.95*0.62;
  const hard = hc*800*u;
  const soft = hard*0.18;
  const land = p.valuation>hard ? p.valuation : hard*0.45;
  const pre = land+hard+soft;
  const loan = pre*0.65;
  const carry = loan*0.065*1.5;
  const total = pre+carry;
  const exit = noi/(cap+0.005);
  const profit = exit-total;
  const eq = total-loan;
  const ds = loan*0.065;
  const cf = noi-ds;
  const irrV = eq>500 ? Math.min(Math.max(irr([-eq,cf,cf,cf,cf,cf+exit-loan]),-50),100) : 0;
  return {
    neighborhood:h, project_type:t, units:u, avg_unit_sf:800, lot_sf:5000,
    status:'active', data_source:'ladbs_permit', rti:p.is_rti||false,
    lat:p.lat, lng:p.lng,
    noi:Math.round(noi), total_cost:Math.round(total), exit_value:Math.round(exit),
    net_profit:Math.round(profit), irr_v:irrV,
    cap_on_cost:Math.round(noi/total*10000)/100,
    dev_spread_pct:Math.round(profit/total*10000)/100,
    permit_source_id:String(p.id),
    underwritten_at:new Date().toISOString(),
  };
}

async function main() {
  // Load permits in pages
  console.log('Loading permits...');
  let all=[], off=0;
  while(true) {
    const path = `/rest/v1/permits?select=id,address,zone,units,valuation,is_rti,permit_type,permit_subtype,lat,lng&valuation=gte.50000&limit=1000&offset=${off}&order=id.asc`;
    const r = await req('GET', path);
    console.log('GET permits offset', off, '-> status:', r.status, 'count:', Array.isArray(r.data) ? r.data.length : 'NOT ARRAY', typeof r.data === 'string' ? r.data.slice(0,100) : '');
    if(!Array.isArray(r.data)||!r.data.length) break;
    all=all.concat(r.data);
    console.log('Loaded',all.length,'permits so far');
    if(r.data.length<1000) break;
    off+=1000;
    await sleep(200);
  }
  console.log('Total to underwrite:',all.length);

  // Underwrite in batches of 200
  let done=0;
  for(let i=0;i<all.length;i+=50) {
    const batch=all.slice(i,i+50);
    const seen=new Set();
    const rows=batch.map(p=>({address:p.address,...uw(p)})).filter(r=>{
      if(!r.address||seen.has(r.permit_source_id)) return false;
      seen.add(r.permit_source_id); return true;
    });
    const r=await req('POST','/rest/v1/sites',rows);
    if(r.status<300) done+=rows.length;
    else console.log('Error:',r.status,JSON.stringify(r.data).slice(0,200));
    if(i%500===0) console.log('Progress:',i,'/',all.length,'stored:',done);
    await sleep(100);
  }
  console.log('DONE. Sites stored:',done);
}

main().catch(e=>{console.error('FATAL:',e.message);process.exit(1);});
