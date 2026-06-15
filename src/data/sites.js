/**
 * ParceLLA — Site data
 * Mock data matching Supabase schema.
 * In production this is replaced by Supabase queries.
 */

export const SITES = [
  { id:1,  addr:'2847 Sunset Blvd',         hood:'Silver Lake',   type:'Multifamily', zone:'R3',      price:1850000, lot:6250,  units:12, usf:780,  demo:true,  rti:true,  isComp:false, ms:0.25,mo:0.50,mt:0.20,mth:0.05 },
  { id:2,  addr:'4120 W 3rd St',             hood:'Koreatown',     type:'Multifamily', zone:'R4',      price:2400000, lot:9800,  units:24, usf:720,  demo:false, rti:false, isComp:false, ms:0.30,mo:0.45,mt:0.20,mth:0.05 },
  { id:3,  addr:'5634 Monte Vista St',       hood:'Highland Park', type:'SFR+ADU',     zone:'R2',      price:880000,  lot:5400,  units:3,  usf:1100, demo:true,  rti:false, isComp:false, ms:0,   mo:0.33,mt:0.34,mth:0.33 },
  { id:4,  addr:'1921 Glendale Blvd',        hood:'Echo Park',     type:'Mixed-Use',   zone:'C2',      price:3100000, lot:8500,  units:18, usf:850,  demo:true,  rti:true,  isComp:false, ms:0.20,mo:0.40,mt:0.30,mth:0.10 },
  { id:5,  addr:'3388 Crenshaw Blvd',        hood:'West Adams',    type:'Multifamily', zone:'R3',      price:1650000, lot:7200,  units:14, usf:760,  demo:false, rti:false, isComp:false, ms:0.25,mo:0.50,mt:0.20,mth:0.05 },
  { id:6,  addr:'6712 Washington Blvd',      hood:'Culver City',   type:'Condo/TH',    zone:'R3',      price:2750000, lot:10200, units:8,  usf:1400, demo:true,  rti:true,  isComp:false, ms:0,   mo:0.25,mt:0.50,mth:0.25 },
  { id:7,  addr:'4455 Fountain Ave',         hood:'Los Feliz',     type:'Multifamily', zone:'RD1.5',   price:2100000, lot:7800,  units:10, usf:900,  demo:true,  rti:false, isComp:false, ms:0.20,mo:0.40,mt:0.30,mth:0.10 },
  { id:8,  addr:'1102 S Hoover St',          hood:'Koreatown',     type:'Multifamily', zone:'R4',      price:1950000, lot:8400,  units:20, usf:700,  demo:false, rti:true,  isComp:false, ms:0.35,mo:0.45,mt:0.15,mth:0.05 },
  { id:9,  addr:'5901 Venice Blvd',          hood:'Mar Vista',     type:'Mixed-Use',   zone:'C2',      price:3400000, lot:9600,  units:16, usf:920,  demo:true,  rti:false, isComp:false, ms:0.15,mo:0.45,mt:0.30,mth:0.10 },
  { id:10, addr:'3214 N Figueroa St',        hood:'Highland Park', type:'Multifamily', zone:'R3',      price:1200000, lot:6000,  units:8,  usf:800,  demo:true,  rti:true,  isComp:false, ms:0.25,mo:0.50,mt:0.25,mth:0    },
  { id:11, addr:'2250 W Olympic Blvd',       hood:'Mid-Wilshire',  type:'Multifamily', zone:'R4',      price:4200000, lot:14000, units:36, usf:750,  demo:false, rti:true,  isComp:false, ms:0.30,mo:0.40,mt:0.20,mth:0.10 },
  { id:12, addr:'1840 Cesar Chavez Ave',     hood:'Boyle Heights', type:'Multifamily', zone:'R3',      price:980000,  lot:5800,  units:10, usf:760,  demo:true,  rti:false, isComp:false, ms:0.20,mo:0.50,mt:0.25,mth:0.05 },
  { id:13, addr:'4622 Prospect Ave',         hood:'Los Feliz',     type:'Condo/TH',    zone:'R3',      price:2300000, lot:8800,  units:6,  usf:1600, demo:true,  rti:true,  isComp:false, ms:0,   mo:0.17,mt:0.50,mth:0.33 },
  { id:14, addr:'3755 S La Cienega Blvd',    hood:'Culver City',   type:'Mixed-Use',   zone:'C4',      price:5800000, lot:18000, units:48, usf:820,  demo:true,  rti:false, isComp:false, ms:0.25,mo:0.45,mt:0.25,mth:0.05 },
  { id:15, addr:'2100 W Silver Lake Dr',     hood:'Silver Lake',   type:'SFR+ADU',     zone:'R2',      price:1100000, lot:8200,  units:4,  usf:1250, demo:true,  rti:false, isComp:false, ms:0,   mo:0.25,mt:0.50,mth:0.25 },
  { id:16, addr:'4890 W Adams Blvd',         hood:'West Adams',    type:'Multifamily', zone:'R3',      price:1400000, lot:6800,  units:12, usf:770,  demo:false, rti:true,  isComp:false, ms:0.25,mo:0.45,mt:0.25,mth:0.05 },
  { id:17, addr:'2780 Virgil Ave',           hood:'Echo Park',     type:'Multifamily', zone:'R3',      price:1580000, lot:6400,  units:9,  usf:840,  demo:true,  rti:false, isComp:false, ms:0.22,mo:0.45,mt:0.22,mth:0.11 },
  { id:18, addr:'6340 Brynhurst Ave',        hood:'Mar Vista',     type:'Condo/TH',    zone:'RD1.5',   price:2050000, lot:9000,  units:5,  usf:1500, demo:true,  rti:true,  isComp:false, ms:0,   mo:0.20,mt:0.60,mth:0.20 },
  { id:19, addr:'7200 Melrose Ave',          hood:'Mid-Wilshire',  type:'Mixed-Use',   zone:'[Q]C2',   price:6200000, lot:16500, units:42, usf:880,  demo:true,  rti:true,  isComp:false, ms:0.25,mo:0.42,mt:0.25,mth:0.08 },
  { id:20, addr:'3040 Leeward Ave',          hood:'Koreatown',     type:'Multifamily', zone:'R4',      price:2100000, lot:9200,  units:22, usf:740,  demo:false, rti:false, isComp:false, ms:0.30,mo:0.45,mt:0.20,mth:0.05 },
  { id:21, addr:'915 N Ave 52',              hood:'Highland Park', type:'SFR+ADU',     zone:'R2',      price:750000,  lot:5000,  units:3,  usf:1050, demo:false, rti:true,  isComp:false, ms:0,   mo:0.33,mt:0.34,mth:0.33 },
  { id:22, addr:'1645 Griffith Park Blvd',   hood:'Silver Lake',   type:'Multifamily', zone:'R3',      price:2200000, lot:7400,  units:14, usf:800,  demo:true,  rti:false, isComp:false, ms:0.22,mo:0.48,mt:0.22,mth:0.08 },
  { id:23, addr:'3100 Sunset Blvd',          hood:'Silver Lake',   type:'Multifamily', zone:'R3',      price:null,    lot:7200,  units:14, usf:800,  demo:true,  rti:false, isComp:true,  ms:0.25,mo:0.50,mt:0.20,mth:0.05 },
  { id:24, addr:'880 N Vermont Ave',         hood:'Los Feliz',     type:'Mixed-Use',   zone:'C2',      price:null,    lot:9400,  units:20, usf:870,  demo:true,  rti:false, isComp:true,  ms:0.20,mo:0.42,mt:0.28,mth:0.10 },
  { id:25, addr:'5200 York Blvd',            hood:'Highland Park', type:'Multifamily', zone:'R3',      price:null,    lot:6100,  units:9,  usf:790,  demo:false, rti:false, isComp:true,  ms:0.25,mo:0.50,mt:0.25,mth:0    },
  { id:26, addr:'1320 S Hoover St',          hood:'Koreatown',     type:'Multifamily', zone:'R4',      price:null,    lot:8800,  units:22, usf:710,  demo:false, rti:false, isComp:true,  ms:0.30,mo:0.45,mt:0.20,mth:0.05 },
  { id:27, addr:'4100 Crenshaw Blvd',        hood:'West Adams',    type:'Multifamily', zone:'R3',      price:null,    lot:7500,  units:13, usf:760,  demo:true,  rti:false, isComp:true,  ms:0.25,mo:0.50,mt:0.20,mth:0.05 },
];
