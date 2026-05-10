// Mission state machine: ordered waypoints, advancing on arrival, with
// completion / abort / failure events.
//
// Pure logic — no DOM. The browser layer drives `tick(ac)` from its main loop
// and listens via `runner.on(event, cb)`.

import { haversineNM, insideRunwayRect } from './nav.js';

// Returns true when `ac` satisfies the arrival_criteria of `wp`.
//   wp = { navaid: <id>, station: <navaid record>, arrival_criteria: {...} }
export function isWaypointReached(ac, wp) {
  if (!wp || !wp.station) return false;
  const crit = wp.arrival_criteria || {};
  const radius = typeof crit.radius_nm === 'number' ? crit.radius_nm : 1.5;
  const d = haversineNM(ac, wp.station);
  if (d > radius) return false;

  if (crit.altitude_band) {
    const [lo, hi] = crit.altitude_band;
    if (typeof ac.alt === 'number' && (ac.alt < lo || ac.alt > hi)) return false;
  }

  if (crit.land) {
    const onGround = !!ac.onGround || (typeof ac.alt === 'number' && ac.alt <= 50);
    const slow = typeof ac.ias === 'number' ? ac.ias <= 40 : true;
    const inRect = wp.station.type === 'ILS' ? insideRunwayRect(ac, wp.station) : true;
    if (!(onGround && slow && inRect)) return false;
  }

  return true;
}

export class MissionRunner {
  constructor() {
    this.mission = null;
    this.waypoints = [];      // resolved waypoints with .station attached
    this.activeIdx = -1;
    this.startTime = 0;       // wall-clock ms when started
    this.elapsedMs = 0;
    this.status = 'idle';     // idle | active | complete | failed | aborted
    this._listeners = Object.create(null);
  }

  on(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
    return this;
  }
  _emit(evt, payload) {
    const ls = this._listeners[evt] || [];
    for (const cb of ls) {
      try { cb(payload); } catch (_) { /* ignore listener errors */ }
    }
  }

  start(mission, navaidsById, now = Date.now()) {
    if (!mission) throw new Error('mission required');
    this.mission = mission;
    this.waypoints = (mission.waypoints || []).map((wp) => ({
      ...wp,
      station: navaidsById[wp.navaid] || null
    }));
    if (this.waypoints.some((w) => !w.station)) {
      throw new Error('mission references unknown navaid');
    }
    this.activeIdx = 0;
    this.startTime = now;
    this.elapsedMs = 0;
    this.status = 'active';
    this._emit('start', { mission, waypoint: this.activeWaypoint() });
    return this;
  }

  abort() {
    if (this.status !== 'active') return;
    this.status = 'aborted';
    this.activeIdx = -1;
    this._emit('abort', {});
  }

  fail(reason) {
    if (this.status !== 'active') return;
    this.status = 'failed';
    this._emit('fail', { reason: reason || 'unknown' });
  }

  activeWaypoint() {
    if (this.activeIdx < 0 || this.activeIdx >= this.waypoints.length) return null;
    return this.waypoints[this.activeIdx];
  }

  total() { return this.waypoints.length; }

  // Drive the state machine. `ac` is the aircraft state.
  tick(ac, now = Date.now()) {
    if (this.status !== 'active') return;
    this.elapsedMs = now - this.startTime;
    const wp = this.activeWaypoint();
    if (!wp) return;
    if (isWaypointReached(ac, wp)) {
      this._emit('reach', { index: this.activeIdx, waypoint: wp });
      this.activeIdx += 1;
      if (this.activeIdx >= this.waypoints.length) {
        this.status = 'complete';
        this._emit('complete', { elapsedMs: this.elapsedMs });
      } else {
        this._emit('advance', { waypoint: this.activeWaypoint(), index: this.activeIdx });
      }
    }
  }
}
