/**
 * ParceLLA — Mapbox GL JS Map Component
 *
 * Features:
 *   - Real LA street tiles (Mapbox light-v11 style)
 *   - IRR-coded pin markers (green ≥18%, amber 12–18%, red <12%)
 *   - RTI sites highlighted with gold ring
 *   - Cluster layer for dense areas
 *   - Click → open detail panel
 *   - Hover tooltip with key metrics
 *   - LA neighborhood boundary overlay
 *   - Fit-to-bounds on filter change
 *
 * Required: MAPBOX_TOKEN in environment
 * npm install mapbox-gl
 */

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAP_COORDS } from '../data/submarkets.js';

mapboxgl.accessToken = process.env.MAPBOX_TOKEN
  || import.meta?.env?.VITE_MAPBOX_TOKEN
  || '';

// ── Color helpers ─────────────────────────────────────────────────────────────
function irrColor(irr) {
  if (irr >= 18) return '#1d9e75';
  if (irr >= 12) return '#ef9f27';
  return '#e24b4a';
}

function irrTextColor(irr) {
  if (irr >= 18) return '#ffffff';
  if (irr >= 12) return '#ffffff';
  return '#ffffff';
}

// ── GeoJSON builder ───────────────────────────────────────────────────────────
export function buildGeoJSON(sites) {
  return {
    type: 'FeatureCollection',
    features: sites.map(site => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          site.coordinates?.lng ?? MAP_COORDS[site.hood]?.lng ?? -118.25,
          site.coordinates?.lat ?? MAP_COORDS[site.hood]?.lat ?? 34.05,
        ],
      },
      properties: {
        id:          site.id,
        address:     site.addr,
        hood:        site.hood,
        type:        site.type,
        zone:        site.zone,
        units:       site.units,
        price:       site.askPrice,
        landCost:    site.landCost,
        totalCost:   site.totalCost,
        noi:         site.noi,
        netProfit:   site.netProfit,
        irr:         site.irrV,
        capOnCost:   site.capOnCost,
        devSpread:   site.devSpreadPct,
        isRTI:       site.rti,
        isComp:      site.isComp,
        exitValue:   site.exitValue,
        color:       irrColor(site.irrV),
        textColor:   irrTextColor(site.irrV),
      },
    })),
  };
}

// ── Map initialization ────────────────────────────────────────────────────────
export function initMap(containerId, options = {}) {
  const map = new mapboxgl.Map({
    container: containerId,
    style:     'mapbox://styles/mapbox/light-v11',
    center:    [-118.2851, 34.0522],   // Downtown LA
    zoom:      11,
    minZoom:   9,
    maxZoom:   18,
    ...options,
  });

  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
  map.addControl(new mapboxgl.FullscreenControl(), 'top-right');

  return map;
}

// ── Layer setup ───────────────────────────────────────────────────────────────
export function setupLayers(map, geojson, onSiteClick) {
  // Remove existing layers/sources if re-rendering
  ['parcella-clusters','parcella-cluster-count','parcella-pins','parcella-rti-ring']
    .forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (map.getSource('parcella-sites')) map.removeSource('parcella-sites');

  map.addSource('parcella-sites', {
    type:    'geojson',
    data:    geojson,
    cluster: true,
    clusterMaxZoom: 13,
    clusterRadius:  50,
    clusterProperties: {
      // Aggregate best IRR in cluster for color coding
      maxIRR: ['max', ['get', 'irr']],
    },
  });

  // Cluster circles
  map.addLayer({
    id:     'parcella-clusters',
    type:   'circle',
    source: 'parcella-sites',
    filter: ['has', 'point_count'],
    paint:  {
      'circle-color': [
        'step', ['get', 'maxIRR'],
        '#e24b4a',   // red  < 12
        12, '#ef9f27', // amber 12–18
        18, '#1d9e75', // green ≥ 18
      ],
      'circle-radius':  ['step', ['get', 'point_count'], 18, 5, 22, 10, 28],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.92,
    },
  });

  // Cluster count labels
  map.addLayer({
    id:     'parcella-cluster-count',
    type:   'symbol',
    source: 'parcella-sites',
    filter: ['has', 'point_count'],
    layout: {
      'text-field':  '{point_count_abbreviated}',
      'text-font':   ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
      'text-size':   12,
    },
    paint:  { 'text-color': '#ffffff' },
  });

  // Individual site pins
  map.addLayer({
    id:     'parcella-pins',
    type:   'circle',
    source: 'parcella-sites',
    filter: ['!', ['has', 'point_count']],
    paint:  {
      'circle-color':        ['get', 'color'],
      'circle-radius':       14,
      'circle-stroke-width': ['case', ['get', 'isRTI'], 3, 1.5],
      'circle-stroke-color': ['case', ['get', 'isRTI'], '#c49a3c', '#ffffff'],
      'circle-opacity':      0.95,
    },
  });

  // IRR label on each pin
  map.addLayer({
    id:     'parcella-pin-labels',
    type:   'symbol',
    source: 'parcella-sites',
    filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': ['concat', ['to-string', ['round', ['get', 'irr']]], '%'],
      'text-font':  ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
      'text-size':  10,
    },
    paint:  { 'text-color': '#ffffff' },
  });

  // ── Interactions ────────────────────────────────────────────────────────────
  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'parcella-popup',
    maxWidth: '260px',
  });

  // Hover tooltip
  map.on('mouseenter', 'parcella-pins', e => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    const fmtM = n => n >= 1e6 ? '$' + (Math.round(n / 1e5) / 10) + 'M'
                    : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K'
                    : '$' + Math.round(n);
    popup.setLngLat(e.features[0].geometry.coordinates)
      .setHTML(`
        <div style="font-family:system-ui;padding:4px 0">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">${p.address}</div>
          <div style="font-size:11px;color:#666;margin-bottom:6px">${p.hood} · ${p.zone} · ${p.units} units</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
            <div style="background:#f5f5f5;padding:4px 6px;border-radius:4px">
              <div style="font-size:9px;color:#999;text-transform:uppercase">IRR</div>
              <div style="font-size:13px;font-weight:600;color:${irrColor(p.irr)}">${Math.round(p.irr * 10) / 10}%</div>
            </div>
            <div style="background:#f5f5f5;padding:4px 6px;border-radius:4px">
              <div style="font-size:9px;color:#999;text-transform:uppercase">Net profit</div>
              <div style="font-size:13px;font-weight:600">${fmtM(p.netProfit)}</div>
            </div>
            <div style="background:#f5f5f5;padding:4px 6px;border-radius:4px">
              <div style="font-size:9px;color:#999;text-transform:uppercase">Cap on cost</div>
              <div style="font-size:13px;font-weight:600">${Math.round(p.capOnCost * 100) / 100}%</div>
            </div>
            <div style="background:#f5f5f5;padding:4px 6px;border-radius:4px">
              <div style="font-size:9px;color:#999;text-transform:uppercase">All-in cost</div>
              <div style="font-size:13px;font-weight:600">${fmtM(p.totalCost)}</div>
            </div>
          </div>
          ${p.isRTI ? '<div style="margin-top:6px;font-size:10px;background:#e1f5ee;color:#085041;padding:3px 7px;border-radius:100px;display:inline-block">✓ RTI Approved</div>' : ''}
          ${p.isComp ? '<div style="margin-top:6px;font-size:10px;background:#faeeda;color:#854f0b;padding:3px 7px;border-radius:100px;display:inline-block">Land imputed</div>' : ''}
        </div>
      `)
      .addTo(map);
  });

  map.on('mouseleave', 'parcella-pins', () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });

  // Click → open detail panel
  map.on('click', 'parcella-pins', e => {
    const p = e.features[0].properties;
    if (onSiteClick) onSiteClick(p.id);
  });

  // Cluster click → zoom in
  map.on('click', 'parcella-clusters', e => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['parcella-clusters'] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource('parcella-sites').getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });
  });

  map.on('mouseenter', 'parcella-clusters', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'parcella-clusters', () => {
    map.getCanvas().style.cursor = '';
  });
}

// ── Update data without full re-init ──────────────────────────────────────────
export function updateMapData(map, sites) {
  const source = map.getSource('parcella-sites');
  if (source) {
    source.setData(buildGeoJSON(sites));
  }
}

// ── Fit map to filtered results ───────────────────────────────────────────────
export function fitToSites(map, sites) {
  if (!sites.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  sites.forEach(site => {
    const lng = site.coordinates?.lng ?? MAP_COORDS[site.hood]?.lng ?? -118.25;
    const lat = site.coordinates?.lat ?? MAP_COORDS[site.hood]?.lat ?? 34.05;
    bounds.extend([lng, lat]);
  });
  map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 });
}

// ── Neighborhood boundary overlay ─────────────────────────────────────────────
export async function addNeighborhoodLayer(map) {
  // LA neighborhood boundaries from city open data GeoJSON
  // In production: fetch from https://data.lacity.org/resource/2drs-n8df.geojson
  // For now adds a subtle label layer at each neighborhood centroid
  const neighborhoods = Object.entries(MAP_COORDS).map(([name, coords]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [coords.lng, coords.lat] },
    properties: { name },
  }));

  if (map.getSource('neighborhoods')) return;

  map.addSource('neighborhoods', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: neighborhoods },
  });

  map.addLayer({
    id:     'neighborhood-labels',
    type:   'symbol',
    source: 'neighborhoods',
    layout: {
      'text-field':         ['get', 'name'],
      'text-font':          ['DIN Offc Pro Regular', 'Arial Unicode MS Regular'],
      'text-size':          11,
      'text-anchor':        'center',
      'text-allow-overlap': false,
    },
    paint:  {
      'text-color':       '#0f1f3d',
      'text-halo-color':  'rgba(255,255,255,0.8)',
      'text-halo-width':  1.5,
      'text-opacity':     0.7,
    },
    minzoom: 10,
    maxzoom: 14,
  });
}
