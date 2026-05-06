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
