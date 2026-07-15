# Realm Craft

> **Build Anything. Drive Everything. Fight Anywhere. Create Forever.**

A next-generation sandbox platform combining open-world driving, creative building,
combat, survival, RPG progression, and user-generated experiences.

## Project Structure

| Path | What it is |
|---|---|
| [docs/VISION.md](docs/VISION.md) | The full design vision — the north star |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased development plan + tech stack recommendation |
| [prototype/](prototype/index.html) | Playable browser prototype (world.js / entities.js / input.js / main.js) |

## Prototype 0.5 — "Realism"

Three explorable dimensions, one seamless game — now with **8 vehicles**, **dynamic weather effects**, and **enhanced realism**.

### Vehicles (8 types)

| Vehicle | Accel | Top Speed | Grip | Handling |
|---|---|---|---|---|
| Sports | 19 | 50 km/h | 9 | Nimble, low center |
| Muscle | 23 | 44 km/h | 6.5 | Fast launch, heavy drift |
| Off-Roader | 14 | 38 km/h | 10 | All-terrain, high clearance |
| Truck | 11 | 34 km/h | 7.5 | Heavy, stable hauling |
| SUV | 16 | 42 km/h | 8.5 | Balanced, family-friendly |
| Van | 13 | 36 km/h | 8 | Cargo hauling, wide turns |
| Motorcycle | 22 | 58 km/h | 7 | Fastest, lightweight |
| Police | 20 | 48 km/h | 9.5 | Pursuit-optimized, lights |

### World Features

- **Surface** — procedural city (36 blocks of window-lit skyscrapers, roads, lamps, parks, AI traffic, pedestrians) surrounded by countryside shaped by a **125-biome classification system**: temperature x moisture x elevation recolor the terrain and pick the vegetation (conifers, broadleaf, palms, cacti).
- **Underworld** — drive through the purple portal east of the city into a lava cavern: glowing pools (they melt you), crystals, stone pillars, ember fog.
- **Sky Realm** — the cyan portal west of the city teleports you onto a chain of floating islands. They descend in steps — jump the gaps at speed.
- **Dynamic Weather** — automatic, biome-biased: snow accumulates on terrain during snowfall, rain creates puddles in the city. Weather affects grip, sky color, fog, and visibility.
- **Snow Accumulation** — snow piling builds up on terrain over time, creating visible white layers that melt when weather clears.
- **Rain Puddles** — puddles form on city surfaces during rain, with realistic water reflection materials.
- **Aurora Borealis** — northern lights shimmer in the night sky during clear weather, with procedural wave animations.
- **Atmospheric Haze** — sky shader includes atmospheric scattering and haze for more realistic horizons.

### Enhanced Audio

- **Engine Sound** — two-oscillator synthesis modulated by speed/gear (sawtooth + triangle)
- **Wind** — procedural wind noise during rain/snow weather
- **Footsteps** — footstep sounds while walking/running on foot
- **Collision Sounds** — impact noise on building/tree collisions
- **Gun Sounds** — noise burst with lowpass filter
- **Mute Toggle** — press `M` to mute all sounds

### Terrain Enhancements

- **Rocks** — scattered dodecahedron rocks in the countryside (80+)
- **Grass Tufts** — hundreds of procedural grass blades in moist biomes that sway in the wind
- **Enhanced Vertex Colors** — mud transitions, cliff faces, deeper vegetation coloring
- **Higher Resolution Terrain** — 200x200 mesh grid for smoother landscape

### AI Improvements

- **22 AI Traffic Cars** (up from 18) with turn signal indicators at intersections
- **35 Pedestrians** (up from 28) with varied skin tones, clothing, and leg animation
- **Smarter Battle Royale Bots** — individual accuracy/aggression stats, distance-based behavior (charge vs. strafe), better target selection, faster retargeting

### Build Mode (7 materials)

Wood, Stone, Brick, Glass, Gold, **Metal**, **Marble** — snap-to-grid placement with raycaster surface detection.

### Controls

**Keyboard + Mouse:**

| Key | Action |
|---|---|
| `W A S D` | Drive / run / fly |
| `Space` | Handbrake (car) / jump (foot) / up (build) |
| `Shift` | Sprint (foot) / down (build) |
| `F` | Get out of / into the car |
| `C` | Chase / cockpit camera |
| `B` | Build mode (LMB place, RMB break, 1-7 material) |
| `G` | Start / quit battle royale |
| `M` | Engine sound on/off |
| `R` | Reset car |

**Gamepad / Controller:**

| Input | Action |
|---|---|
| Left stick | Move / steer |
| Right stick | Look / aim |
| A / Cross | Jump |
| B / Circle | Enter / exit car |
| X / Square | Build mode |
| Y / Triangle | Battle royale |
| LB | Sprint |
| RB | Camera toggle |
| LT | Handbrake |
| RT | Fire (battle royale) |
| Select | Reset car |
| Start | Fullscreen |

**Touch (mobile / tablet):**

| Control | Action |
|---|---|
| Left joystick | Move / steer |
| Right area drag | Look / aim |
| On-screen buttons | All actions (jump, brake, sprint, fire, enter/exit, build, fight, camera, reset, fullscreen) |

## Play Online

Play the latest build directly in your browser at:
**https://samir2006.github.io/realm-craft/**

## Run Locally

```
npx serve prototype
```

Or open `prototype/index.html` in a browser (needs internet once for the Three.js CDN).

## Status

**Phase 0 — Foundation.** See the [roadmap](docs/ROADMAP.md). The prototype proves the
core loops; AAA visuals come from the engine build (recommendation: Unreal Engine 5).
