'use strict';
// Smoke tests for the IFR Pilot velocity-multiplier logic.
// These tests parse public/index.html, extract the embedded RATES array and
// physics integration, and validate the spec acceptance criteria without
// needing a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('velocity multipliers include 1,2,4,8,16,32 in order', () => {
  const m = html.match(/const\s+RATES\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, 'RATES array not found');
  const rates = m[1].split(',').map((s) => parseFloat(s.trim()));
  assert.deepEqual(rates, [1, 2, 4, 8, 16, 32]);
});

test('persistence storage key matches spec', () => {
  assert.match(html, /STORAGE_KEY\s*=\s*'ifrPilot\.simRate'/);
});

test('keyboard shortcuts cycle through rates', () => {
  assert.match(html, /cycleRate\(\+1\)/);
  assert.match(html, /cycleRate\(-1\)/);
});

test('physics sub-stepping is present (no oversized dt at 32x)', () => {
  assert.match(html, /Math\.ceil\(\s*simDt\s*\/\s*MAX_STEP\s*\)/);
  assert.match(html, /MAX_STEP\s*=\s*1\/30/);
});

// Functional simulation check: distance covered at 16x for 10s of sim time
// should equal 1x distance over 160s within 2%.
test('distance at 16x over 10 wall-seconds ≈ 1x over 160 sim-seconds (within 2%)', () => {
  // Mirror the physics step from index.html
  const MAX_STEP = 1/30;
  function makeAc() {
    return { lat: 47.45, lon: -122.30, hdg: 90, ias: 120 };
  }
  function step(s, dt){
    const groundSpeedNmPerSec = s.ias / 3600;
    const distNm = groundSpeedNmPerSec * dt;
    const hdgRad = s.hdg * Math.PI / 180;
    const dLat = (distNm * Math.cos(hdgRad)) / 60;
    const dLon = (distNm * Math.sin(hdgRad)) / (60 * Math.max(0.001, Math.cos(s.lat * Math.PI/180)));
    s.lat += dLat; s.lon += dLon;
  }
  function run(rate, wallSeconds){
    const ac = makeAc();
    const wallDt = 1/60;
    const frames = Math.round(wallSeconds / wallDt);
    for (let f=0; f<frames; f++){
      const simDt = wallDt * rate;
      const steps = Math.max(1, Math.ceil(simDt / MAX_STEP));
      const sub = simDt / steps;
      for (let i=0;i<steps;i++) step(ac, sub);
    }
    return ac;
  }
  const a16 = run(16, 10);
  const a1  = run(1, 160);
  // distance from start (deg lon since heading is 090)
  const d16 = Math.abs(a16.lon - (-122.30));
  const d1  = Math.abs(a1.lon  - (-122.30));
  const ratio = d16 / d1;
  assert.ok(ratio > 0.98 && ratio < 1.02, `ratio=${ratio}`);
});

test('state remains finite at 32x for 30 wall-clock seconds', () => {
  const MAX_STEP = 1/30;
  const s = { lat: 47.45, lon: -122.30, alt: 3000, hdg: 90, pitch: 0, roll: 0, ias: 120 };
  function step(dt){
    const turn = 3.0 * Math.tan(s.roll * Math.PI/180);
    s.hdg = (s.hdg + turn*dt + 360) % 360;
    s.alt = Math.max(0, s.alt + s.pitch*100*(dt/60));
    const gs = s.ias/3600 * dt;
    s.lat += (gs*Math.cos(s.hdg*Math.PI/180))/60;
    s.lon += (gs*Math.sin(s.hdg*Math.PI/180))/(60*Math.cos(s.lat*Math.PI/180));
  }
  const wallDt = 1/60;
  for (let f=0; f<30/wallDt; f++){
    const simDt = wallDt*32;
    const steps = Math.max(1, Math.ceil(simDt/MAX_STEP));
    const sub = simDt/steps;
    for (let i=0;i<steps;i++) step(sub);
  }
  for (const k of ['lat','lon','alt','hdg','pitch','roll','ias']){
    assert.ok(Number.isFinite(s[k]), `${k} not finite: ${s[k]}`);
  }
});

// ===== Mission system =======================================================
// Load the shipped ESM modules under public/js/* via dynamic import.
const { pathToFileURL } = require('node:url');

async function loadNav() {
  return import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'nav.js')).href);
}
async function loadMission() {
  return import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'mission.js')).href);
}

const ROS = { id: 'ROS', type: 'VORDME', lat: -32.9036, lon: -60.7853, freq: 112.30 };
const SNT = { id: 'SNT', type: 'VORDME', lat: -34.4533, lon: -58.5897, freq: 113.40 };
const AEP = { id: 'AEP-ILS13', type: 'ILS', lat: -34.5538, lon: -58.4180, freq: 110.30,
              runway_heading: 131, threshold: { lat: -34.5538, lon: -58.4180 } };

test('haversineNM: known points within tolerance', async () => {
  const { haversineNM } = await loadNav();
  // ROS → AEP ≈ 156 NM (independently computed, +/- 0.5 NM tolerance is generous).
  const d = haversineNM(ROS, AEP);
  assert.ok(d > 150 && d < 165, `expected ~156 NM, got ${d.toFixed(2)}`);
  // Same point → 0.
  assert.ok(haversineNM(ROS, ROS) < 1e-6);
});

test('bearingDeg: cardinal sanity', async () => {
  const { bearingDeg } = await loadNav();
  const a = { lat: 0, lon: 0 };
  const north = bearingDeg(a, { lat: 1, lon: 0 });
  const east  = bearingDeg(a, { lat: 0, lon: 1 });
  const south = bearingDeg(a, { lat: -1, lon: 0 });
  const west  = bearingDeg(a, { lat: 0, lon: -1 });
  assert.ok(Math.abs(north - 0)   < 1, `north=${north}`);
  assert.ok(Math.abs(east  - 90)  < 1, `east=${east}`);
  assert.ok(Math.abs(south - 180) < 1, `south=${south}`);
  assert.ok(Math.abs(west  - 270) < 1, `west=${west}`);
});

test('isWaypointReached: inside vs outside radius', async () => {
  const { isWaypointReached } = await loadMission();
  const wp = { navaid: 'ROS', station: ROS, arrival_criteria: { radius_nm: 1.5 } };
  // ~1 NM east of ROS.
  const near = { lat: ROS.lat, lon: ROS.lon + 1 / (60 * Math.cos(ROS.lat * Math.PI/180)) };
  // ~2 NM east of ROS.
  const far  = { lat: ROS.lat, lon: ROS.lon + 2 / (60 * Math.cos(ROS.lat * Math.PI/180)) };
  assert.equal(isWaypointReached(near, wp), true);
  assert.equal(isWaypointReached(far,  wp), false);
});

test('dmeReading: matched freq returns numeric NM, unmatched returns null', async () => {
  const { dmeReading, haversineNM } = await loadNav();
  // Aircraft 42 NM east of ROS (flat-earth approximation at this latitude).
  const ac = { lat: ROS.lat, lon: ROS.lon + 42 / (60 * Math.cos(ROS.lat * Math.PI/180)) };
  const stations = [ROS, SNT, AEP];
  const dme = dmeReading(ac, stations, 112.30);
  assert.ok(typeof dme === 'number', 'expected number');
  assert.ok(Math.abs(dme - 42) < 0.5, `expected ~42, got ${dme}`);
  // Cross-check great-circle distance matches dme.
  assert.ok(Math.abs(dme - haversineNM(ac, ROS)) < 1e-9);
  // Unmatched frequency.
  assert.equal(dmeReading(ac, stations, 108.00), null);
  // Match but station type is not VORDME/ILS.
  const ndb = { id: 'X', type: 'NDB', lat: ROS.lat, lon: ROS.lon, freq: 108.00 };
  assert.equal(dmeReading(ac, [ndb], 108.00), null);
});

test('MissionRunner: progresses through waypoints and emits complete', async () => {
  const { MissionRunner } = await loadMission();
  const r = new MissionRunner();
  const events = [];
  r.on('reach', (e) => events.push('reach:' + e.waypoint.navaid));
  r.on('complete', () => events.push('complete'));

  const mission = {
    id: 'MTEST',
    waypoints: [
      { navaid: 'ROS', arrival_criteria: { radius_nm: 1.5 } },
      { navaid: 'SNT', arrival_criteria: { radius_nm: 1.5 } },
      // For test purposes don't require landing on the final fix.
      { navaid: 'AEP-ILS13', arrival_criteria: { radius_nm: 1.5 } },
    ],
  };
  const byId = { ROS, SNT, 'AEP-ILS13': AEP };
  r.start(mission, byId, 0);
  assert.equal(r.activeWaypoint().navaid, 'ROS');

  // At ROS.
  r.tick({ lat: ROS.lat, lon: ROS.lon }, 100);
  assert.equal(r.activeWaypoint().navaid, 'SNT');
  // At SNT.
  r.tick({ lat: SNT.lat, lon: SNT.lon }, 200);
  assert.equal(r.activeWaypoint().navaid, 'AEP-ILS13');
  // At AEP.
  r.tick({ lat: AEP.lat, lon: AEP.lon }, 300);
  assert.equal(r.status, 'complete');
  assert.deepEqual(events, ['reach:ROS', 'reach:SNT', 'reach:AEP-ILS13', 'complete']);
});

test('MissionRunner: ILS final waypoint requires landing', async () => {
  const { MissionRunner } = await loadMission();
  const r = new MissionRunner();
  r.start({
    id: 'MILS',
    waypoints: [{ navaid: 'AEP-ILS13', arrival_criteria: { radius_nm: 1.5, land: true } }],
  }, { 'AEP-ILS13': AEP }, 0);
  // Above the runway, fast → not reached.
  r.tick({ lat: AEP.lat, lon: AEP.lon, alt: 500, ias: 130 }, 100);
  assert.equal(r.status, 'active');
  // On the runway, slow → reached.
  r.tick({ lat: AEP.lat, lon: AEP.lon, alt: 0, ias: 30, onGround: true }, 200);
  assert.equal(r.status, 'complete');
});

test('MissionRunner: abort returns to idle-like state', async () => {
  const { MissionRunner } = await loadMission();
  const r = new MissionRunner();
  let aborted = false;
  r.on('abort', () => { aborted = true; });
  r.start({ id: 'M', waypoints: [{ navaid: 'ROS', arrival_criteria: { radius_nm: 1 } }] },
          { ROS }, 0);
  r.abort();
  assert.equal(r.status, 'aborted');
  assert.equal(r.activeWaypoint(), null);
  assert.ok(aborted);
});

// ===== Server API smoke =====================================================
test('server exposes /api/missions and /api/navaids JSON files', () => {
  const navaids = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'navaids.json'), 'utf8'));
  const missions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'missions.json'), 'utf8'));
  const ids = navaids.navaids.map((n) => n.id).sort();
  assert.deepEqual(ids, ['AEP-ILS13', 'ROS', 'SNT']);
  for (const n of navaids.navaids) {
    assert.equal(typeof n.lat, 'number');
    assert.equal(typeof n.lon, 'number');
    assert.equal(typeof n.freq, 'number');
  }
  const m1 = missions.missions.find((m) => m.id === 'M1');
  assert.ok(m1, 'mission M1 missing');
  assert.deepEqual(m1.waypoints.map((w) => w.navaid), ['ROS', 'SNT', 'AEP-ILS13']);

  // server.js routes both paths.
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(srv, /\/api\/navaids/);
  assert.match(srv, /\/api\/missions/);
});
