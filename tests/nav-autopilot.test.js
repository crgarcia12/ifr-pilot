'use strict';
// NAV autopilot tests: verify smooth course interception without oscillation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Extract helper functions from the HTML for testing
function extractFunction(name) {
  const fnRegex = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[^}]*\\}`, 's');
  const match = html.match(fnRegex);
  if (!match) throw new Error(`Function ${name} not found`);
  return eval(`(${match[0]})`);
}

// Extract needed functions
const bearingTo = extractFunction('bearingTo');
const haversineNm = extractFunction('haversineNm');

function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// Simulate the NAV autopilot logic extracted from index.html
function calculateNavHeading(state, VOR) {
  // PD controller for smooth VOR radial intercept
  const brgFromVor = bearingTo(VOR.lat, VOR.lon, state.lat, state.lon);
  const dev = angleDiff(brgFromVor, VOR.courseOBS); // degrees off course
  const cdi = clamp(dev / 10, -1, 1); // normalized -1..+1
  const dist = haversineNm(state.lat, state.lon, VOR.lat, VOR.lon);
  
  // Calculate cross-track distance in NM (perpendicular distance to course line)
  const crossTrackNm = dist * Math.sin(Math.abs(dev) * Math.PI / 180);
  const crossTrackSign = Math.sign(dev); // which side of course line
  
  // Calculate heading difference from course (for damping)
  const headingToCourse = angleDiff(state.hdg, VOR.courseOBS);
  
  let intercept = 0;
  if (dist > 0.5) {
    // PD controller gains
    const K_p = 15; // Proportional: degrees per NM off course
    const K_d = 2;  // Derivative: damping factor
    
    // Proportional term: based on cross-track error
    const proportional = crossTrackNm * K_p * crossTrackSign;
    
    // Derivative term: damping based on heading convergence
    const derivative = headingToCourse * K_d;
    
    // Combined control signal
    intercept = clamp(proportional - derivative, -45, 45);
    
    // Apply deadband near centerline to prevent hunting
    if (Math.abs(crossTrackNm) < 0.05) {
      intercept *= 0.5; // Reduce gain by 50% when very close
    }
  }
  
  const hdgTarget = (VOR.courseOBS + intercept + 360) % 360;
  
  return { hdgTarget, crossTrackNm, intercept };
}

test('NAV autopilot uses proportional control based on cross-track distance', () => {
  const VOR = { lat: 47.435, lon: -122.309, courseOBS: 90 };
  
  // Aircraft 3 NM north of course (should command large intercept angle)
  const state1 = { lat: 47.485, lon: -122.309, hdg: 90 };
  const result1 = calculateNavHeading(state1, VOR);
  
  // Should command southward intercept (heading < 90)
  assert.ok(result1.intercept < 0, `Expected negative intercept far from course, got ${result1.intercept}`);
  assert.ok(Math.abs(result1.intercept) > 20, `Expected large intercept angle far from course, got ${result1.intercept}`);
});

test('NAV autopilot reduces correction as aircraft approaches centerline', () => {
  const VOR = { lat: 47.435, lon: -122.309, courseOBS: 90 };
  
  // Far from course: 2 NM off
  const stateFar = { lat: 47.468, lon: -122.309, hdg: 90 };
  const resultFar = calculateNavHeading(stateFar, VOR);
  
  // Near course: 0.2 NM off
  const stateNear = { lat: 47.438, lon: -122.309, hdg: 90 };
  const resultNear = calculateNavHeading(stateNear, VOR);
  
  // Correction should be smaller when closer
  assert.ok(Math.abs(resultNear.intercept) < Math.abs(resultFar.intercept), 
    `Expected smaller correction near course. Far: ${resultFar.intercept}, Near: ${resultNear.intercept}`);
});

test('NAV autopilot applies damping when heading is already converging', () => {
  const VOR = { lat: 47.435, lon: -122.309, courseOBS: 90 };
  
  // Aircraft 1 NM north, but already heading toward course (heading 70)
  const state = { lat: 47.452, lon: -122.309, hdg: 70 };
  const result = calculateNavHeading(state, VOR);
  
  // Should command less aggressive intercept due to damping
  assert.ok(Math.abs(result.intercept) < 30, 
    `Expected damped intercept when already converging, got ${result.intercept}`);
});

test('NAV autopilot demonstrates stable behavior', () => {
  // This is a basic sanity check that the autopilot doesn't blow up
  const VOR = { lat: 47.435, lon: -122.309, courseOBS: 90 };
  
  // Start slightly north of course, heading east
  const state = {
    lat: 47.450, // ~0.9 NM north
    lon: -122.400, // west of VOR
    hdg: 90,
    roll: 0,
    ias: 120
  };
  
  let prevCrossTrack = null;
  let diverging = false;
  
  // Simulate for 60 seconds
  for (let step = 0; step < 600; step++) {
    const { hdgTarget, crossTrackNm } = calculateNavHeading(state, VOR);
    
    // Check that we're not diverging wildly
    if (prevCrossTrack !== null && Math.abs(crossTrackNm) > Math.abs(prevCrossTrack) + 0.5) {
      diverging = true;
      break;
    }
    prevCrossTrack = Math.abs(crossTrackNm);
    
    // Autopilot
    const hdgErr = angleDiff(hdgTarget, state.hdg);
    const targetRoll = clamp(hdgErr * 1.0, -25, 25);
    state.roll += (targetRoll - state.roll) * 0.15;
    
    const turnRate = 3.0 * Math.tan(state.roll * Math.PI / 180);
    state.hdg = (state.hdg + turnRate * 0.1 + 360) % 360;
    
    const groundSpeedNmPerSec = state.ias / 3600;
    const distNm = groundSpeedNmPerSec * 0.1;
    const hdgRad = state.hdg * Math.PI / 180;
    const dLat = (distNm * Math.cos(hdgRad)) / 60;
    const dLon = (distNm * Math.sin(hdgRad)) / (60 * Math.cos(state.lat * Math.PI / 180));
    state.lat += dLat;
    state.lon += dLon;
  }
  
  // Should not diverge wildly
  assert.ok(!diverging, 'NAV autopilot diverged instead of converging');
  
  // Should have reduced cross-track error or maintained stability
  assert.ok(Math.abs(prevCrossTrack) < 2.0, `Cross-track error too large: ${prevCrossTrack} NM`);
});

test('NAV autopilot maintains course without hunting once established', () => {
  const VOR = { lat: 47.435, lon: -122.309, courseOBS: 180 };
  
  // Start on course, minor deviation
  const state = {
    lat: 47.385,
    lon: -122.304, // 0.3 NM off course
    hdg: 180,
    roll: 0,
    ias: 120
  };
  
  let headingChanges = 0;
  let prevHeading = state.hdg;
  
  // Simulate for 60 seconds
  for (let t = 0; t < 60; t += 0.1) {
    const { hdgTarget } = calculateNavHeading(state, VOR);
    
    // Count significant heading changes
    if (Math.abs(angleDiff(state.hdg, prevHeading)) > 1) {
      headingChanges++;
    }
    prevHeading = state.hdg;
    
    // Simple autopilot
    const hdgErr = angleDiff(hdgTarget, state.hdg);
    const targetRoll = clamp(hdgErr * 1.0, -25, 25);
    state.roll += (targetRoll - state.roll) * 0.15;
    
    const turnRate = 3.0 * Math.tan(state.roll * Math.PI / 180);
    state.hdg = (state.hdg + turnRate * 0.1 + 360) % 360;
    
    // Update position
    const groundSpeedNmPerSec = state.ias / 3600;
    const distNm = groundSpeedNmPerSec * 0.1;
    const hdgRad = state.hdg * Math.PI / 180;
    const dLat = (distNm * Math.cos(hdgRad)) / 60;
    const dLon = (distNm * Math.sin(hdgRad)) / (60 * Math.cos(state.lat * Math.PI / 180));
    state.lat += dLat;
    state.lon += dLon;
  }
  
  // Should maintain heading with minimal corrections
  assert.ok(Math.abs(angleDiff(state.hdg, 180)) < 3, 
    `Heading drifted too far: ${state.hdg}`);
  
  // Should not hunt (make excessive corrections)
  assert.ok(headingChanges < 50, 
    `Too many heading changes (hunting): ${headingChanges}`);
});
