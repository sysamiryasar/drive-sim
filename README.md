# Realm Drive

> Open-world browser driving: drift, jump, race, deliver, escape the cops — and build a garage.

A Three.js driving sandbox with real 3D models, arcade stunt scoring, races, delivery
jobs, collectibles, 43 achievements, daily challenges and a persistent garage that
gives players a reason to come back every day.

## Play Online

Play the latest build in your browser: **https://samir2006.github.io/realm-craft/**

## Run Locally

```bash
npx serve .
```

Then open the printed URL. Serve the repo root (not `prototype/`) so the game can reach `models/`.

## What's in the game

### Garage & progression
- **15 vehicles** built from real 3D models — hatchback and sedan to start, then taxi, delivery van,
  SUV, pickup, Street Sport, motorcycle, ambulance, luxury SUV, police Interceptor, fire truck,
  Rally Racer, Hyper Concept, and the photoreal **Italia 458** supercar. Each unlocks at a player
  level and is bought with cash; many have perks (more delivery pay, drift bonus, bigger nitro tank, siren…).
- **Paint shop** — 11 paints (recolors the real model textures live in the 3D showroom).
- **Cash + XP + levels**, a live 3D car preview on the home screen, and a session recap when you return.
- **Saves automatically** in the browser (`localStorage`).

### Reasons to come back
- **Daily challenges** — three new goals every day (scaled to your level) plus a sweep bonus.
- **Login streak** — rewards grow each consecutive day ($250 → $2,000 on day 7).
- **43 achievements** with progress bars and cash rewards.
- **Records** — race medals and best times, speed-trap bests, stars found, stunt jumps cleared, career stats.

### Arcade scoring
Chain tricks within 4 seconds to grow a **combo multiplier (up to x15)**, then bank it for cash and XP.
Crashing, getting busted or hitting a pedestrian loses the combo.
- **Drifts** (handbrake slides), **near misses** past traffic and cops, **big air**, **smashing props**,
  and **speed traps**.
- **Nitro** (Shift) refills over time and with every trick.

### Things to do
- **3 races** with countdowns, checkpoint gates and bronze/silver/gold times: Downtown Dash,
  Ring Road Sprint, Countryside Rally.
- **Delivery jobs** — pick up at a 📦 depot, beat the clock, chain deliveries for a growing streak multiplier.
- **11 stunt ramps**, including a **Stunt Park** with a MEGA RAMP south-west of the city.
- **40 hidden stars** — street level, mid-air above ramps, out in the countryside and at the map's edges.
- **Cash bags**, **3 speed traps**, smashable cones/crates/hydrants/bins.
- **Police** — escape a chase to earn a payout scaled to your wanted level; helicopters, roadblocks and
  spike strips at high wanted levels.
- Still here: flyable plane (P), build mode (B), dynamic weather and day/night.

### Controls

**Keyboard**

| Key | Action |
|---|---|
| `W` `S` / arrows | Accelerate / brake & reverse |
| `A` `D` / arrows | Steer |
| `Space` | Handbrake (drift) |
| `Shift` | Nitro |
| `H` | Horn (siren on emergency vehicles) |
| `C` | Chase / roof / top camera |
| `F` | Headlights |
| `R` | Reset car (also abandons a race or delivery) |
| `P` | Plane |
| `B` | Build mode |
| `M` | Sound on/off |
| `Esc` | Pause → resume or go to the garage |

**Gamepad:** left stick steer · RT accelerate · LT brake/reverse · LB handbrake · RB nitro ·
A horn · B camera · X reset · Y fullscreen · Start pause.

**Touch:** left joystick to drive, plus on-screen handbrake, N₂O, horn, camera, reset, pause and fullscreen buttons.

## Project Structure

| Path | What it is |
|---|---|
| `index.html` | Page, HUD and home-screen markup and styles |
| `world.js` | Renderer, terrain, city, ramps, sky, ground queries |
| `entities.js` | 3D model loading, vehicle roster, paint jobs, traffic, pedestrians, police, plane |
| `progress.js` | Save data, cash/XP/levels, achievements, daily challenges, login streak |
| `activities.js` | Combo scoring, props, stars, cash bags, speed traps, races, deliveries, escapes |
| `garage.js` | Home screen: garage, paint shop, daily, achievements, records |
| `input.js` | Keyboard, gamepad and touch input |
| `main.js` | Game loop, car physics, cameras, HUD, audio |
| `models/` | GLB models — see [models/CREDITS.md](models/CREDITS.md) |
| `prototype/` | Mirror of the game files |
| [docs/VISION.md](docs/VISION.md), [docs/ROADMAP.md](docs/ROADMAP.md) | Long-term design vision and plan |

## Credits

Vehicles, props and pedestrians: [Kenney](https://kenney.nl) Car Kit and Blocky Characters (CC0).
Italia 458: "Ferrari 458 Italia" by vicent091036, as bundled with the three.js car example.
Details in [models/CREDITS.md](models/CREDITS.md).
