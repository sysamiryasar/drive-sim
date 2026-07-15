# Realm Craft — Development Roadmap

The [vision](VISION.md) describes a decade-scale platform. Games like that are not built
in one leap — they are built as a series of small, playable, finished things, each one
proving out a pillar of the vision. This roadmap turns the dream into that series.

**The one rule:** every phase ends with something you can actually play. No phase is
"engine work with nothing to show."

---

## Phase 0 — Foundation (now)

**Goal:** a playable proof of the two core pillars — driving and building — plus a
committed tech-stack decision.

- ✅ Vision document
- ✅ Browser prototype (`prototype/`): city + biomes + Underworld + Sky Realm,
  physics-based driving with cockpit view, on-foot parkour character, build mode,
  auto weather (rain/snow), battle royale vs AI bots, garage, day/night cycle
- ⬜ Pick the engine (see recommendation below) and install it
- ⬜ Complete the engine's official "first game" tutorial end-to-end
- ⬜ Recreate the prototype's core loop (drive + place blocks) inside the engine

**Exit criteria:** you can drive a vehicle and place a block in the real engine.

## Phase 1 — Vertical Slice: "One Island" (months, not weeks)

**Goal:** one small island (~2×2 km) where every core system exists in miniature.

- Third-person character: walk, run, jump, swim, enter/exit vehicle
- 2–3 vehicles (one car, one off-roader, one boat) with arcade-plus physics
- Grid building system: ~20 block/prop types, place, rotate, delete
- Save/load the world and player state
- Day/night cycle and one weather type (rain)
- Simple HUD, pause menu, settings (graphics quality, keybinds)

**Exit criteria:** a stranger can play for 30 minutes without instructions and have fun.

## Phase 2 — Systems Depth

**Goal:** make the slice feel alive; deepen instead of widen.

- Vehicle physics v2: suspension, weight transfer, surface grip, damage states
- Building v2: materials, snapping pieces (walls/floors/ramps), blueprints, undo
- First NPCs: ambient traffic and a handful of pedestrians
- Wildlife: birds and one land animal with simple AI
- Progression v1: XP from driving/building/exploring, unlock vehicles and block sets
- Photo mode v1 (free camera, filters, screenshot)

**Exit criteria:** players come back for a second session without being asked.

## Phase 3 — Combat & Game Modes

**Goal:** the third pillar, built on the stable foundation.

- Third-person combat first (aim, shoot, melee, health); first-person camera after
- 4–6 weapons across archetypes (pistol, rifle, shotgun, launcher, melee)
- Movement expansion: slide, vault, mantle; grappling hook as the fun spike
- PvE: wave-defense mode on the island
- Race mode: checkpoint races against AI ghosts, leaderboard

**Exit criteria:** three distinct ways to play one island — explore/build, race, fight.

## Phase 4 — Multiplayer

**Goal:** the hardest technical phase. Sequence it strictly:

1. Local co-op / listen server, 2–4 players
2. Dedicated server, 8–16 players, one region
3. Text chat, parties, basic trading
4. Scale testing toward 32–64; 200+ is a live-ops milestone, not a launch requirement

**Non-negotiable:** all game systems from Phases 1–3 must be written server-authoritative
or easily convertible — retrofitting multiplayer is the classic project killer, so
Phase 1 code should already separate simulation from presentation.

**Exit criteria:** two friends on different PCs build a base and race each other.

## Phase 5 — Creator Platform & Economy

**Goal:** hand the keys to the players.

- In-game world editor (the same tools you used to build the island, polished)
- Visual scripting v1 (triggers, timers, spawners, win conditions)
- Publish/browse/join player-made worlds
- Cosmetic economy first; creator monetization only after moderation tooling exists

**Exit criteria:** a player builds and publishes a minigame you never imagined.

## Phase 6+ — The Living Universe (live ops)

New regions, seasons and dynamic weather systems, natural disasters, survival mode,
aircraft and trains, guilds, marketplace, ranked competitive, mod support, console
ports. Each ships as an update to a game people already love.

---

## Tech Stack Recommendation

| Option | Strengths | Risks |
|---|---|---|
| **Unreal Engine 5** | World Partition = seamless open world ("no loading screens" solved), Nanite/Lumen = AAA visuals, Chaos Vehicles built in, free until $1M revenue | C++/Blueprint learning curve; heavy tooling |
| **Unity 6** | C# (matches the vision's scripting goal), fastest iteration, biggest tutorial ecosystem, great asset store for vehicles/terrain | Open-world streaming and top-tier visuals need more hand-rolling |
| **Godot 4** | Free/open source, lightweight, C# supported, great first engine | Weakest fit for huge streamed open worlds and AAA rendering |

**Recommendation:** **Unreal Engine 5** for the real build — it is the only option where
the vision's hardest technical targets (seamless streaming, AAA presentation,
vehicle physics, 100+ player replication via Iris) are engine features rather than
things you build yourself. If C# and gentler learning matter more right now, Unity is
the pragmatic second choice — and skills transfer.

Prototype fast and throw prototypes away (like the browser one in this repo) — but
commit to one engine before Phase 1 and don't switch.

## Honest Scope Notes

- The vision lists roughly 15 games' worth of features. That's fine — it's a north
  star, not a checklist. Ship the island.
- Driving + building is the differentiator. Nothing else ships until those two feel
  incredible together.
- Multiplayer at 200+ players, simulation-grade tire physics, and a creator economy
  are all real — as *later* phases, funded by an audience earned in earlier ones.
