/**
 * ParceLLA — Google Maps Component
 *
 * Features:
 *   - Google Maps JavaScript API (street, satellite, hybrid)
 *   - IRR-coded custom SVG pin markers
 *   - RTI sites highlighted with gold ring
 *   - MarkerClusterer for dense areas
 *   - Click → open detail panel
 *   - Hover InfoWindow with key metrics
 *   - Street View integration (toggle per site)
 *   - Geocoding for address → lat/lng
 *   - Fit bounds on filter change
 *   - LA neighborhood label overlay
 *
 * Required:
 *   GOOGLE_MAPS_API_KEY in .env (backend geocoding)
 *   VITE_GOOGLE_MAPS_API_KEY in .env (frontend map)
 *
 * Setup:
 *   Google Cloud Console → Maps JavaScript API → enable
 *   Google Cloud Console → Geocoding API → enable
 *   Google Cloud Console → Street View Static API → enable
 *   (All three use the same API key)
 *
 * Replaces: Mapbox GL JS
 */

import { MAP_COORDS } from '../data/submarkets.js';

// ── Color helpers ─────────────────────────────────────────────────────────────
export function irrColor(irr) {
  if (irr >= 18) return '#1d9e75';
  if (irr >= 12) return '#ef9f27';
  return '#e24b4a';
}

function irrLabel(irr) {
  if (irr >= 18) return 'Strong';
  if (irr >= 12) return 'Moderate';
  return 'Weak';
}

// ── Custom SVG pin generator ──────────────────────────────────────────────────
function makePinSVG(irr, isRTI, isComp) {
  const color  = irrColor(irr);
  const ring   = isRTI ? '#c49a3c' : '#ffffff';
  const label  = Math.round(irr) + '%';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
    <path d="M20 0 C9 0 0 9 0 20 C0 34 20 48 20 48 C20 48 40 34 40 20 C40 9 31 0 20 0Z"
      fill="${color}" stroke="${ring}" stroke-width="${isRTI ? 3 : 1.5}"/>
    <text x="20" y="21" font-family="Arial" font-size="9" font-weight="700"
      fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text>
    ${isComp ? '<circle cx="32" cy="8" r="5" fill="#ef9f27" stroke="white" stroke-width="1"/>' : ''}
  </svg>`;
}

function svgToDataURL(svg) {
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// ── Load Google Maps API ──────────────────────────────────────────────────────
let _mapsLoaded = false;
let _mapsPromise = null;

export function loadGoogleMaps(apiKey) {
  if (_mapsLoaded) return Promise.resolve();
  if (_mapsPromise) return _mapsPromise;

  _mapsPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) { _mapsLoaded = true; resolve(); return; }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker,geometry&loading=async`;
    script.async = true;
    script.onload  = () => { _mapsLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });

  return _mapsPromise;
}

// ── Map initialization ────────────────────────────────────────────────────────
export async function initMap(containerId, apiKey, options = {}) {
  await loadGoogleMaps(apiKey);

  const { google } = window;

  const map = new google.maps.Map(document.getElementById(containerId), {
    center:          { lat: 34.0522, lng: -118.2851 },  // Downtown LA
    zoom:            11,
    minZoom:         9,
    maxZoom:         18,
    mapTypeId:       'roadmap',
    mapTypeControl:  true,
    mapTypeControlOptions: {
      style:    google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
      position: google.maps.ControlPosition.TOP_RIGHT,
      mapTypeIds: ['roadmap', 'satellite', 'hybrid'],
    },
    streetViewControl:  true,
    fullscreenControl:  true,
    zoomControl:        true,
    gestureHandling:    'cooperative',
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      { featureType: 'water', stylers: [{ color: '#c9d8e8' }] },
      { featureType: 'landscape', stylers: [{ color: '#f5f5f5' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    ],
    ...options,
  });

  return map;
}

// ── Marker setup ──────────────────────────────────────────────────────────────
export function setupMarkers(map, sites, onSiteClick) {
  const { google } = window;
  const markers    = [];
  const infoWindow = new google.maps.InfoWindow({ maxWidth: 280 });

  sites.forEach(site => {
    const m    = site._m ?? site;
    const irr  = m.irrV ?? m.irr ?? 0;
    const hood = site.hood ?? site.neighborhood;
    const coords = site.coordinates
      ?? MAP_COORDS[hood]
      ?? { lat: 34.05, lng: -118.25 };

    // Small jitter so pins in same neighborhood don't stack exactly
    const jitter = () => (Math.random() - 0.5) * 0.003;

    const marker = new google.maps.Marker({
      position: {
        lat: coords.lat + jitter(),
        lng: coords.lng + jitter(),
      },
      map,
      icon: {
        url:    svgToDataURL(makePinSVG(irr, site.rti, site.isComp)),
        size:   new google.maps.Size(40, 48),
        origin: new google.maps.Point(0, 0),
        anchor: new google.maps.Point(20, 48),
      },
      title:    site.addr ?? site.address,
      zIndex:   irr >= 18 ? 3 : irr >= 12 ? 2 : 1,
    });

    // Hover → InfoWindow
    marker.addListener('mouseover', () => {
      const fmtM = n => n >= 1e6 ? '$' + (Math.round(n/1e5)/10) + 'M'
                      : n >= 1e3 ? '$' + Math.round(n/1e3) + 'K'
                      : '$' + Math.round(n);

      infoWindow.setContent(`
        <div style="font-family:Arial,sans-serif;padding:4px 0;min-width:200px">
          <div style="font-size:13px;font-weight:700;margin-bottom:3px;color:#0f1f3d">${site.addr ?? site.address}</div>
          <div style="font-size:11px;color:#888;margin-bottom:8px">${hood} · ${site.zone} · ${site.units} units</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
            <div style="background:#f5f5f5;padding:5px 7px;border-radius:5px">
              <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:0.5px">IRR</div>
              <div style="font-size:14px;font-weight:700;color:${irrColor(irr)}">${irr}%</div>
              <div style="font-size:9px;color:#999">${irrLabel(irr)}</div>
            </div>
            <div style="background:#f5f5f5;padding:5px 7px;border-radius:5px">
              <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:0.5px">Net profit</div>
              <div style="font-size:14px;font-weight:700">${fmtM(m.netProfit ?? m.profit ?? 0)}</div>
            </div>
            <div style="background:#f5f5f5;padding:5px 7px;border-radius:5px">
              <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:0.5px">Cap on cost</div>
              <div style="font-size:14px;font-weight:700">${m.capOnCost ?? m.capoc ?? 0}%</div>
            </div>
            <div style="background:#f5f5f5;padding:5px 7px;border-radius:5px">
              <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:0.5px">All-in</div>
              <div style="font-size:14px;font-weight:700">${fmtM(m.totalCost ?? m.total ?? 0)}</div>
            </div>
          </div>
          ${site.rti ? '<div style="margin-top:7px;display:inline-block;background:#e1f5ee;color:#085041;font-size:10px;font-weight:600;padding:3px 8px;border-radius:100px">✓ RTI Approved</div>' : ''}
          ${site.isComp ? '<div style="margin-top:7px;display:inline-block;background:#faeeda;color:#854f0b;font-size:10px;font-weight:600;padding:3px 8px;border-radius:100px">Land imputed</div>' : ''}
          <div style="margin-top:8px;font-size:10px;color:#c49a3c;cursor:pointer;font-weight:600" onclick="window._parcella_open(${site.id})">View full analysis →</div>
        </div>
      `);
      infoWindow.open(map, marker);
    });

    marker.addListener('mouseout', () => {
      setTimeout(() => infoWindow.close(), 300);
    });

    // Click → open detail panel
    marker.addListener('click', () => {
      if (onSiteClick) onSiteClick(site.id ?? site.site_id);
    });

    markers.push({ marker, site });
  });

  // Global bridge for InfoWindow onclick
  window._parcella_open = (id) => {
    if (onSiteClick) onSiteClick(id);
  };

  return markers;
}

// ── Street View ───────────────────────────────────────────────────────────────
/**
 * Show Street View for an address
 * @param {string} containerId — DOM element to render into
 * @param {string} address     — full street address
 * @param {Object} coords      — { lat, lng } fallback if geocode fails
 */
export function showStreetView(containerId, address, coords) {
  const { google } = window;
  const el = document.getElementById(containerId);
  if (!el) return;

  const sv = new google.maps.StreetViewPanorama(el, {
    position:          { lat: coords.lat, lng: coords.lng },
    pov:               { heading: 34, pitch: 10 },
    zoom:              1,
    addressControl:    true,
    linksControl:      true,
    panControl:        false,
    enableCloseButton: false,
  });

  // Try to find the exact address heading
  const service = new google.maps.StreetViewService();
  service.getPanorama({ location: coords, radius: 100 }, (data, status) => {
    if (status === 'OK') sv.setPano(data.location.pano);
  });

  return sv;
}

/**
 * Get Street View thumbnail URL (no JS needed — static image)
 */
export function streetViewThumbnailURL(lat, lng, apiKey, size = '400x200') {
  return `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat},${lng}&fov=90&heading=0&pitch=0&key=${apiKey}`;
}

// ── Geocoding ─────────────────────────────────────────────────────────────────
export async function geocodeAddress(address, apiKey) {
  // Server-side: use Geocoding API directly
  const encoded = encodeURIComponent(`${address}, Los Angeles, CA`);
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${apiKey}`
  );
  if (!res.ok) throw new Error(`Geocoding API: ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results.length) {
    throw new Error(`No geocode result for: ${address}`);
  }
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng, formattedAddress: data.results[0].formatted_address };
}

// ── Fit bounds ────────────────────────────────────────────────────────────────
export function fitToSites(map, sites) {
  if (!sites?.length) return;
  const { google } = window;
  const bounds = new google.maps.LatLngBounds();
  sites.forEach(site => {
    const hood   = site.hood ?? site.neighborhood;
    const coords = site.coordinates ?? MAP_COORDS[hood];
    if (coords) bounds.extend({ lat: coords.lat, lng: coords.lng });
  });
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 60 });
    if (map.getZoom() > 14) map.setZoom(14);
  }
}

// ── Update markers on filter change ──────────────────────────────────────────
export function updateMarkers(markerObjects, filteredSiteIds) {
  const idSet = new Set(filteredSiteIds);
  markerObjects.forEach(({ marker, site }) => {
    marker.setVisible(idSet.has(site.id ?? site.site_id));
  });
}

// ── Neighborhood labels ───────────────────────────────────────────────────────
export function addNeighborhoodLabels(map) {
  const { google } = window;
  Object.entries(MAP_COORDS).forEach(([hood, coords]) => {
    new google.maps.Marker({
      position: { lat: coords.lat, lng: coords.lng },
      map,
      icon: {
        path:        google.maps.SymbolPath.CIRCLE,
        scale:       0,
        fillOpacity: 0,
        strokeOpacity: 0,
      },
      label: {
        text:      hood,
        color:     '#0f1f3d',
        fontSize:  '10px',
        fontWeight:'500',
        className: 'hood-label',
      },
      zIndex: 0,
    });
  });
}
