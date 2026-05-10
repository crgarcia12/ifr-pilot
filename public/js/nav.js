// Navigation math helpers.
// ESM module — usable both in the browser (import from /js/nav.js) and
// in Node tests via dynamic import.

const R_NM = 3440.065; // Earth radius in nautical miles.

function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }

// Great-circle distance between two {lat,lon} points in nautical miles.
export function haversineNM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial true bearing in degrees from a → b (0..360).
export function bearingDeg(a, b) {
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
          - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// DME reception range — line-of-sight is not modelled.
export const DME_MAX_NM = 200;

// Frequency match tolerance (MHz). 0.01 ≈ ~ a single channel either way.
const FREQ_EPS = 0.011;

// Returns DME distance in NM (number, 1 decimal precision rounding done by caller)
// when `tunedFreq` matches a VORDME or ILS station within DME_MAX_NM.
// Otherwise returns null.
//
//   ac        — { lat, lon }
//   stations  — array of navaids ({ id, type, lat, lon, freq })
//   tunedFreq — number (MHz) | string
export function dmeReading(ac, stations, tunedFreq) {
  const f = typeof tunedFreq === 'string' ? parseFloat(tunedFreq) : tunedFreq;
  if (!Number.isFinite(f)) return null;
  if (!Array.isArray(stations)) return null;
  for (const s of stations) {
    if (s.type !== 'VORDME' && s.type !== 'ILS') continue;
    if (Math.abs(s.freq - f) > FREQ_EPS) continue;
    const d = haversineNM(ac, s);
    if (d > DME_MAX_NM) continue;
    return d;
  }
  return null;
}

// Are we inside the runway threshold "landing rectangle"?
// rectangle is centred on threshold, oriented along runway_heading,
// length 1500 m, width 60 m (per spec).
export function insideRunwayRect(ac, ils) {
  if (!ils || !ils.threshold || typeof ils.runway_heading !== 'number') return false;
  // Convert to local NM coords centred on threshold.
  const dN = (ac.lat - ils.threshold.lat) * 60;
  const dE = (ac.lon - ils.threshold.lon) * 60 * Math.cos(toRad(ils.threshold.lat));
  // Rotate so runway heading aligns with +x.
  const θ = toRad(ils.runway_heading);
  // North-east → along-runway/across-runway:
  //   along  =  dN * cos(θ) + dE * sin(θ)
  //   across = -dN * sin(θ) + dE * cos(θ)
  const along  =  dN * Math.cos(θ) + dE * Math.sin(θ);
  const across = -dN * Math.sin(θ) + dE * Math.cos(θ);
  // 1500 m along, 60 m wide → in NM:
  const halfLen = 1500 / 1852 / 2;   // ~0.405 NM
  const halfWid = 60   / 1852 / 2;   // ~0.016 NM
  return Math.abs(along) <= halfLen && Math.abs(across) <= halfWid;
}
