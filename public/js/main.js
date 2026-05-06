// IFR Pilot — mission/nav/HUD bootstrap.
// This module is loaded with <script type="module"> AFTER the inline simulator
// has booted. It mounts:
//   • A "Missions" panel + start/abort buttons
//   • NAV1 + DME readout
//   • Active-waypoint HUD
//   • Mouse-wheel zoom + click-drag pan + +/- buttons on the moving map
//   • Mission completion / failure modal
//
// It reads/writes the simulator state via window.__ifrPilot.state.

import { haversineNM, bearingDeg, dmeReading } from './nav.js';
import { MissionRunner } from './mission.js';

const ifr = window.__ifrPilot;
if (!ifr) {
  console.error('[ifr-pilot] core sim not initialised');
}

const state = ifr.state;

// --- Map state ---------------------------------------------------------------
// Discrete zoom levels: half-extent in NM. Default level 1 = 5 NM (matches the
// previous static rendering).
const MAP_SCALES = [2, 5, 10, 25, 50, 100, 200, 400];
const DEFAULT_ZOOM = 1;
state.map = {
  zoomLevel: DEFAULT_ZOOM,
  scaleNm: MAP_SCALES[DEFAULT_ZOOM],
  centerLat: state.lat,
  centerLon: state.lon,
  follow: true,    // when true, centre auto-tracks aircraft
};

function setZoom(level) {
  const clamped = Math.max(0, Math.min(MAP_SCALES.length - 1, level));
  state.map.zoomLevel = clamped;
  state.map.scaleNm = MAP_SCALES[clamped];
}

function shiftCenter(dxPx, dyPx) {
  // Snapshot of px-per-NM at current canvas size.
  const c = document.getElementById('cv-map');
  if (!c) return;
  const rect = c.getBoundingClientRect();
  const pxPerNm = Math.min(rect.width, rect.height) / 2 / state.map.scaleNm;
  if (pxPerNm <= 0) return;
  // Pixel right → world east; pixel down → world south. The map is north-up,
  // so dragging the cursor down should pan the world down with it (the viewport
  // reveals more of the south); same for dragging right (reveals more east).
  // i.e. centerLat decreases as dy increases, centerLon decreases as dx increases.
  const dN = dyPx / pxPerNm;
  const dE = -dxPx / pxPerNm;
  if (state.map.follow) {
    // Switch to free-pan mode the first time the user pans.
    state.map.centerLat = state.lat;
    state.map.centerLon = state.lon;
    state.map.follow = false;
  }
  state.map.centerLat += dN / 60;
  state.map.centerLon += dE / (60 * Math.cos(state.map.centerLat * Math.PI / 180));
}

// --- DOM overlay -------------------------------------------------------------
const styles = document.createElement('style');
styles.textContent = `
  #ifr-overlay{position:fixed;top:60px;right:8px;width:280px;display:flex;flex-direction:column;gap:8px;z-index:5;font-family:inherit;color:var(--ink)}
  #ifr-overlay .pnl{background:var(--panel);border:1px solid var(--edge);border-radius:8px;padding:8px}
  #ifr-overlay .pnl h2{margin:0 0 6px;font-size:11px;letter-spacing:.2em;color:var(--dim);text-transform:uppercase;display:flex;justify-content:space-between}
  #ifr-overlay .pnl h2 .badge{color:var(--accent);font-weight:700}
  #ifr-overlay .pnl button{appearance:none;border:1px solid #28405c;background:#0e1620;color:var(--ink);font-family:inherit;font-size:11px;padding:5px 8px;border-radius:5px;cursor:pointer}
  #ifr-overlay .pnl button:hover{border-color:#3a5a82}
  #ifr-overlay .pnl button.danger{border-color:#5a2828;color:#ff8b8b}
  #ifr-overlay .pnl button.primary{background:var(--accent);color:#001b10;border-color:var(--accent);font-weight:700}
  #ifr-mission-list{display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto}
  .mission-card{background:#0a121b;border:1px solid var(--edge);border-radius:6px;padding:6px}
  .mission-card .ttl{font-size:12px;color:var(--ink);font-weight:600}
  .mission-card .desc{font-size:10px;color:var(--dim);margin:3px 0 6px}
  .mission-card .route{font-size:10px;color:var(--accent);letter-spacing:.1em;margin-bottom:6px}
  #ifr-nav1{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center}
  #ifr-nav1 .freq{font-size:18px;color:var(--accent);letter-spacing:.05em;font-weight:700}
  #ifr-nav1 .dme{font-size:18px;color:var(--ink);text-align:right;font-weight:700}
  #ifr-nav1 input{background:#0a121b;border:1px solid var(--edge);color:var(--ink);font-family:inherit;font-size:14px;padding:3px 4px;border-radius:4px;width:100%}
  #ifr-nav1 .freq-ctrl{display:flex;gap:4px;align-items:center}
  #ifr-nav1 .freq-ctrl button{padding:2px 6px}
  #ifr-active{font-size:12px;line-height:1.5}
  #ifr-active .lbl{color:var(--dim);font-size:10px;letter-spacing:.15em}
  #ifr-active .v{color:var(--ink);font-weight:600}
  #ifr-active .wp{font-size:14px;color:var(--accent);font-weight:700}
  #ifr-map-ctrl{position:absolute;right:6px;bottom:6px;display:flex;flex-direction:column;gap:3px;z-index:6}
  #ifr-map-ctrl button{appearance:none;width:26px;height:22px;border:1px solid #28405c;background:rgba(14,22,32,.85);color:var(--ink);font-family:inherit;font-size:14px;cursor:pointer;border-radius:3px;line-height:1}
  #ifr-map-ctrl button:hover{border-color:#3a5a82}
  #ifr-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.7);z-index:20}
  #ifr-modal.show{display:flex}
  #ifr-modal .box{background:var(--panel);border:1px solid var(--accent);border-radius:8px;padding:18px 24px;text-align:center;min-width:260px}
  #ifr-modal h3{margin:0 0 8px;color:var(--accent);letter-spacing:.2em;font-size:14px}
  #ifr-modal p{margin:0 0 12px;color:var(--ink);font-size:13px}
  /* Mission briefing — full-screen splash shown on load and via "Missions" button. */
  #ifr-briefing{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(2,5,9,.92);z-index:30;font-family:inherit;color:var(--ink)}
  #ifr-briefing.show{display:flex}
  #ifr-briefing .wrap{background:var(--panel);border:1px solid var(--accent);border-radius:10px;padding:24px 28px;max-width:680px;width:92%;max-height:88vh;overflow-y:auto;box-shadow:0 0 40px rgba(0,255,157,.15)}
  #ifr-briefing h2{margin:0 0 4px;color:var(--accent);letter-spacing:.25em;font-size:16px}
  #ifr-briefing .sub{color:var(--dim);font-size:11px;letter-spacing:.2em;margin-bottom:16px;text-transform:uppercase}
  #ifr-briefing .b-list{display:flex;flex-direction:column;gap:10px}
  #ifr-briefing .b-card{background:#0a121b;border:1px solid var(--edge);border-radius:8px;padding:12px 14px;transition:border-color .15s}
  #ifr-briefing .b-card:hover{border-color:#3a5a82}
  #ifr-briefing .b-card .b-id{font-size:11px;color:var(--dim);letter-spacing:.2em}
  #ifr-briefing .b-card .b-ttl{font-size:15px;color:var(--ink);font-weight:700;margin:2px 0 6px}
  #ifr-briefing .b-card .b-desc{font-size:12px;color:var(--ink);opacity:.8;margin-bottom:8px;line-height:1.5}
  #ifr-briefing .b-card .b-route{font-size:11px;color:var(--accent);letter-spacing:.15em;margin-bottom:10px;font-weight:700}
  #ifr-briefing .b-card button{appearance:none;border:1px solid var(--accent);background:var(--accent);color:#001b10;font-family:inherit;font-size:12px;font-weight:700;padding:8px 16px;border-radius:5px;cursor:pointer;letter-spacing:.15em}
  #ifr-briefing .b-card button:hover{filter:brightness(1.1)}
  #ifr-briefing .close{position:absolute;top:14px;right:18px;background:none;border:0;color:var(--dim);font-size:22px;cursor:pointer}
  #ifr-briefing .close:hover{color:var(--ink)}
  #ifr-missions-btn{appearance:none;border:1px solid var(--accent);background:transparent;color:var(--accent);font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.2em;padding:5px 10px;border-radius:4px;cursor:pointer;margin-left:auto}
  #ifr-missions-btn:hover{background:var(--accent);color:#001b10}
`;
document.head.appendChild(styles);

const overlay = document.createElement('div');
overlay.id = 'ifr-overlay';
overlay.innerHTML = `
  <div class="pnl" id="pnl-missions">
    <h2><span>Missions</span><span class="badge" id="ifr-mission-count">0</span></h2>
    <div id="ifr-mission-list"></div>
  </div>
  <div class="pnl" id="pnl-active" style="display:none">
    <h2><span>Active Mission</span><span class="badge" id="ifr-mission-id">—</span></h2>
    <div id="ifr-active">
      <div><span class="lbl">WP </span><span class="wp" id="ifr-wp">—</span> <span class="v" id="ifr-wp-pos">(0/0)</span></div>
      <div><span class="lbl">BRG </span><span class="v" id="ifr-wp-brg">---</span>°  <span class="lbl">DIST </span><span class="v" id="ifr-wp-dist">--.-</span> NM</div>
      <div><span class="lbl">ELP </span><span class="v" id="ifr-wp-elp">00:00</span></div>
    </div>
    <div style="margin-top:8px"><button id="ifr-abort" class="danger">Abort Mission</button></div>
  </div>
  <div class="pnl">
    <h2><span>NAV 1</span><span class="badge" id="ifr-nav1-id">---</span></h2>
    <div id="ifr-nav1">
      <div class="freq-ctrl">
        <button id="ifr-nav1-down" type="button">−</button>
        <input id="ifr-nav1-freq" type="number" min="108.00" max="118.00" step="0.05" value="112.30" />
        <button id="ifr-nav1-up" type="button">+</button>
      </div>
      <div class="dme"><span id="ifr-dme">---</span> <span style="font-size:11px;color:var(--dim)">NM</span></div>
    </div>
  </div>
`;
document.body.appendChild(overlay);

// Mission Briefing splash — visible on first load so the user sees the
// available missions immediately, even on small screens.
const briefing = document.createElement('div');
briefing.id = 'ifr-briefing';
briefing.innerHTML = `
  <div class="wrap" style="position:relative">
    <button class="close" id="ifr-briefing-close" title="Close">×</button>
    <h2>MISSION BRIEFING</h2>
    <div class="sub">Select a mission to begin</div>
    <div class="b-list" id="ifr-briefing-list"></div>
  </div>
`;
document.body.appendChild(briefing);
document.getElementById('ifr-briefing-close').addEventListener('click', () => {
  briefing.classList.remove('show');
});

// Header "Missions" button to re-open the briefing.
(function addHeaderBtn() {
  const hdr = document.querySelector('header .pfd');
  if (!hdr) return;
  const btn = document.createElement('button');
  btn.id = 'ifr-missions-btn';
  btn.type = 'button';
  btn.textContent = '✈ MISSIONS';
  btn.title = 'Open mission briefing';
  btn.addEventListener('click', () => briefing.classList.add('show'));
  hdr.appendChild(btn);
})();

// Modal for mission complete / failed.
const modal = document.createElement('div');
modal.id = 'ifr-modal';
modal.innerHTML = `<div class="box">
  <h3 id="ifr-modal-title">MISSION</h3>
  <p id="ifr-modal-body"></p>
  <button id="ifr-modal-ok" class="primary">OK</button>
</div>`;
document.body.appendChild(modal);
function showModal(title, body) {
  document.getElementById('ifr-modal-title').textContent = title;
  document.getElementById('ifr-modal-body').textContent = body;
  modal.classList.add('show');
}
document.getElementById('ifr-modal-ok').addEventListener('click', () => modal.classList.remove('show'));

// --- Map zoom / pan UI -------------------------------------------------------
const mapWrap = document.getElementById('map');
const mapCanvas = document.getElementById('cv-map');
const mapCtrl = document.createElement('div');
mapCtrl.id = 'ifr-map-ctrl';
mapCtrl.innerHTML = `
  <button id="ifr-map-zin" title="Zoom in">+</button>
  <button id="ifr-map-zout" title="Zoom out">−</button>
  <button id="ifr-map-follow" title="Re-centre on aircraft">⊕</button>
`;
mapWrap.appendChild(mapCtrl);
document.getElementById('ifr-map-zin').addEventListener('click', () => setZoom(state.map.zoomLevel - 1));
document.getElementById('ifr-map-zout').addEventListener('click', () => setZoom(state.map.zoomLevel + 1));
document.getElementById('ifr-map-follow').addEventListener('click', () => { state.map.follow = true; });

mapCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.deltaY < 0) setZoom(state.map.zoomLevel - 1);
  else if (e.deltaY > 0) setZoom(state.map.zoomLevel + 1);
}, { passive: false });

let drag = null;
mapCanvas.addEventListener('mousedown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  mapCanvas.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  shiftCenter(dx, dy);
});
window.addEventListener('mouseup', () => { drag = null; mapCanvas.style.cursor = ''; });
mapCanvas.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') setZoom(state.map.zoomLevel - 1);
  else if (e.key === '-' || e.key === '_') setZoom(state.map.zoomLevel + 1);
});

// --- Data fetch --------------------------------------------------------------
let NAVAIDS = [];
let NAVAIDS_BY_ID = {};
let MISSIONS = [];

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

async function loadData() {
  try {
    const [n, m] = await Promise.all([
      fetchJson('api/navaids').catch(() => fetchJson('data/navaids.json')),
      fetchJson('api/missions').catch(() => fetchJson('data/missions.json')),
    ]);
    NAVAIDS = n.navaids || [];
    NAVAIDS_BY_ID = Object.fromEntries(NAVAIDS.map((x) => [x.id, x]));
    MISSIONS = m.missions || [];
    renderMissions();
    // Don't auto-open the briefing splash — it covers the cockpit panels
    // (VOR/HSI, Autopilot). User can click the "✈ MISSIONS" header button.
    // Expose for the inline drawMap.
    window.__ifrNavaids = NAVAIDS;
  } catch (err) {
    console.error('[ifr-pilot] failed to load data', err);
  }
}

// --- Mission UI --------------------------------------------------------------
const runner = new MissionRunner();
window.__ifrMission = runner;

function renderMissions() {
  const list = document.getElementById('ifr-mission-list');
  document.getElementById('ifr-mission-count').textContent = String(MISSIONS.length);
  list.innerHTML = '';
  for (const m of MISSIONS) {
    const card = document.createElement('div');
    card.className = 'mission-card';
    const route = (m.waypoints || []).map((w) => w.navaid).join(' → ');
    card.innerHTML = `
      <div class="ttl">${m.id}: ${m.title || ''}</div>
      <div class="desc">${m.description || ''}</div>
      <div class="route">${route}</div>
      <button data-id="${m.id}" class="primary start-btn">Start Mission</button>
    `;
    card.querySelector('.start-btn').addEventListener('click', () => startMission(m.id));
    list.appendChild(card);
  }
  // Also populate the full-screen briefing splash.
  const blist = document.getElementById('ifr-briefing-list');
  if (blist) {
    blist.innerHTML = '';
    if (!MISSIONS.length) {
      blist.innerHTML = '<div style="color:var(--dim);font-size:12px">No missions available.</div>';
    }
    for (const m of MISSIONS) {
      const route = (m.waypoints || []).map((w) => w.navaid).join('  →  ');
      const card = document.createElement('div');
      card.className = 'b-card';
      card.innerHTML = `
        <div class="b-id">MISSION ${m.id}</div>
        <div class="b-ttl">${m.title || ''}</div>
        <div class="b-desc">${m.description || ''}</div>
        <div class="b-route">${route}</div>
        <button data-id="${m.id}" type="button">▶ START MISSION</button>
      `;
      card.querySelector('button').addEventListener('click', () => {
        startMission(m.id);
        document.getElementById('ifr-briefing').classList.remove('show');
      });
      blist.appendChild(card);
    }
  }
}

function startMission(id) {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) return;
  // Reset aircraft to mission start.
  if (m.start) {
    state.lat = m.start.lat;
    state.lon = m.start.lon;
    state.hdg = m.start.heading || 0;
    state.alt = m.start.altitude_ft != null ? m.start.altitude_ft : state.alt;
    state.ias = m.start.speed_kt != null ? m.start.speed_kt : state.ias;
    state.pitch = 0; state.roll = 0; state.vs = 0;
  }
  // Centre map on aircraft and follow.
  state.map.centerLat = state.lat;
  state.map.centerLon = state.lon;
  state.map.follow = true;
  // Wider default zoom for missions so the route is visible.
  setZoom(5);
  // Tune NAV1 to first navaid for convenience.
  const first = NAVAIDS_BY_ID[m.waypoints[0].navaid];
  if (first && first.freq) {
    const inp = document.getElementById('ifr-nav1-freq');
    inp.value = first.freq.toFixed(2);
  }
  runner.start(m, NAVAIDS_BY_ID, performance.now());
  document.getElementById('pnl-active').style.display = 'block';
  document.getElementById('pnl-missions').style.display = 'none';
  document.getElementById('ifr-mission-id').textContent = m.id;
  // Expose route for the map renderer.
  window.__ifrActiveRoute = runner.waypoints.map((w) => w.station);
}

function endMissionUI() {
  document.getElementById('pnl-active').style.display = 'none';
  document.getElementById('pnl-missions').style.display = 'block';
  window.__ifrActiveRoute = null;
}

runner.on('complete', ({ elapsedMs }) => {
  showModal('MISSION COMPLETE', `Elapsed: ${fmtElapsed(elapsedMs)}`);
  endMissionUI();
});
runner.on('fail', () => { showModal('MISSION FAILED', 'Try again.'); endMissionUI(); });
runner.on('abort', () => { endMissionUI(); });

document.getElementById('ifr-abort').addEventListener('click', () => runner.abort());

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60), ss = s % 60;
  return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

// --- NAV1 + DME --------------------------------------------------------------
const nav1FreqEl = document.getElementById('ifr-nav1-freq');
function nav1Freq() { return parseFloat(nav1FreqEl.value); }
function bumpFreq(d) {
  const v = (parseFloat(nav1FreqEl.value) || 108) + d;
  nav1FreqEl.value = (Math.round(v * 100) / 100).toFixed(2);
}
document.getElementById('ifr-nav1-up').addEventListener('click', () => bumpFreq(0.05));
document.getElementById('ifr-nav1-down').addEventListener('click', () => bumpFreq(-0.05));

// --- Per-frame update --------------------------------------------------------
function update() {
  // Auto-follow centre on aircraft.
  if (state.map.follow) {
    state.map.centerLat = state.lat;
    state.map.centerLon = state.lon;
  }
  // Mission tick.
  runner.tick(state, performance.now());
  // DME readout.
  const f = nav1Freq();
  const station = NAVAIDS.find((s) => Math.abs(s.freq - f) <= 0.011 && (s.type === 'VORDME' || s.type === 'ILS'));
  document.getElementById('ifr-nav1-id').textContent = station ? station.id : '---';
  const dme = dmeReading(state, NAVAIDS, f);
  document.getElementById('ifr-dme').textContent = dme == null ? '---' : dme.toFixed(1);
  // Active waypoint HUD.
  if (runner.status === 'active') {
    const wp = runner.activeWaypoint();
    if (wp) {
      const brg = bearingDeg(state, wp.station);
      const d = haversineNM(state, wp.station);
      document.getElementById('ifr-wp').textContent = wp.navaid;
      document.getElementById('ifr-wp-pos').textContent = `(${runner.activeIdx + 1}/${runner.total()})`;
      document.getElementById('ifr-wp-brg').textContent = String(Math.round(brg)).padStart(3, '0');
      document.getElementById('ifr-wp-dist').textContent = d.toFixed(1);
      document.getElementById('ifr-wp-elp').textContent = fmtElapsed(runner.elapsedMs);
    }
  }
  requestAnimationFrame(update);
}

requestAnimationFrame(update);
loadData();
