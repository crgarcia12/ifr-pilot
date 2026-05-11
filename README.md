# ifr-pilot
i am a plane lover. I want to build a web game. be creative.

## Missions

The game now ships a **mission system**. The first mission `M1` flies
`ROS → SNT → AEP ILS 13` (Rosario VOR → San Fernando VOR → ILS RWY 13 at
Aeroparque).

Open the game and use the right-hand panel:

- **Start Mission** — repositions the aircraft and activates the first waypoint.
- **NAV1 / DME** — type a frequency or use ± buttons. Tune `112.30` for ROS,
  `113.40` for SNT, `110.30` for AEP ILS. DME shows nautical miles (one decimal)
  to a tuned VORDME / ILS station within 200 NM, otherwise `---`.
- **Active waypoint HUD** shows bearing, distance and progress (`n / total`).
- **Abort Mission** returns to the missions panel.

### Map

The moving map is now zoomable and pannable.

- **Mouse wheel** — zoom in/out across 8 levels (2 NM detail → 400 NM regional).
- **Click and drag** — pan the map (switches to free mode).
- **+ / − / ⊕ buttons** — zoom in, zoom out, recentre on the aircraft.

### API

The server exposes the underlying JSON for the UI and for tests:

- `GET /api/missions` → mission catalogue
- `GET /api/navaids` → navaid catalogue

