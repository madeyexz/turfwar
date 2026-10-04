# Lawbreaker // Frontline

A browser-first, keyboard-and-mouse sci-fi infantry shooter in the spirit of PlanetSide-style base
fights and fast browser FPS games — with one unfair advantage: you can **rewrite the laws of
physics with a sentence**. Capture three objectives across four original battlefields, against
bots or real players through SpacetimeDB, and when the fight turns, bend gravity around the
reactor, make time move only when you move, slow light to walking speed, or rewind the world
while you stay free.

Built with Vite, TypeScript, Three.js, Zod and SpacetimeDB. Bun is the package manager and script
runner (`bun` / `bunx`, never npm/npx).

## What is in the game

| Area | Implemented |
| --- | --- |
| Modes | **Solo skirmish** (6v6, bots fill both teams, three difficulties), **Online match** (SpacetimeDB-authoritative; humans replace bots; maps rotate between rounds), **Law Lab** (no bots, passive sentinels — a sandbox for experimenting with laws). |
| Objective | Domination: capture A, B and C (8 s solo capture, faster with more teammates, frozen while contested). Owned points tick team score; kills add score; first to 200 or most after 10 min wins, then a new round starts. |
| Battlefields | **Cinder Basin** (desert outpost: reactor plaza, comm bunkers, ridge watchtower, cargo yard), **Frostline Reach** (arctic relay: walled reactor courtyard with gates and wall-top catwalks, rooftop towers, frozen trench with a bridge, crystal ridge), **Verdant Divide** (jungle uplink: reactor plateau, clearing bunkers, creek bed, tree cover). **Ochre Quarter** (desert old town: an original homage to the classic two-site layout of CS:GO's Dust II — Long with its doors, corner and pit, Mid with the crate and doors, Catwalk up to Short, roofed Tunnels — built from our own geometry and CC0 assets). The first three lanes-and-flanks layouts are rotationally symmetric for fairness (tested); Ochre Quarter keeps its source's attacker/defender asymmetry on purpose (team 0 attacks from the south, A and C are the defenders' sites, B is Mid). Team spawns are protected by one-way energy shields. |
| Gunplay | Hitscan weapons with fire rate, magazines, timed reloads, hip/ADS/moving/air spread, per-shot bloom, recoil climb with partial recovery, view punch, damage falloff and head/leg multipliers. Kits: **Assault** (VX-7 pulse carbine + P-12 sidearm) and **Recon** (L-90 scoped rail rifle + R-6 magnum). Grenades (G) are physical bodies that obey the laws. |
| Movement | Shared deterministic controller: walk, sprint (with sprint-to-fire delay), crouch, slide (crouch while sprinting), jump with coyote time, step-up, ramps/stairs, team shields. |
| Feel | First-person rigged arms (cut from the soldier rig) posed by IK onto CC0 weapon models; procedural sway, figure-eight bob, kick, sprint carry, ADS with red-dot reticle, scope overlay, reload choreography with a magazine in hand, equip and grenade throw; muzzle flash, tracers, impact sparks and dust, bullet marks, explosions; hit markers, headshot/kill confirms, damage-direction arcs, kill feed, procedural WebAudio gunshots, reloads, footsteps and cues; a looping 60-second menu theme sequenced from those same effects. |
| Characters | CC0 rigged base body with an armored suit: helmet with glowing visor, plates, pack, pauldrons, bracers and boots as one rigid-skinned geometry (three draw calls per soldier). CC0 animation library retargeted by bone name: idle/walk/jog/sprint/crouch/jump/slide/death blend by speed, legs twist for strafing, cycles reverse when backpedalling, bladed rifle stance, aim pitch through the spine, two-bone arm IK onto the weapon, posed hands, hit flinches. |
| Bots | Navigation grid generated from each map (multi-level: roofs, catwalks, stairs), A* paths, objective selection that spreads the team, perception with field of view and line of sight, reaction delays, imperfect lead, aim error that settles, strafing and range keeping, burst fire, crouching, reloading and grenades at last-known positions. |
| Settings | Deploy screen: graphics preset (Low / Medium / High), mouse sensitivity, field of view (vertical, with the 16:9 horizontal equivalent), and a 30-second performance check. Saved per browser. |
| HUD | Score/objective bar, capture progress, world markers, teammate name tags, rotating minimap (enemies appear when they fire), vitals with regenerating shield, ammo, laws panel, death screen with kit choice, scoreboard (Tab), end-of-round screen, law command bar. |

## The four laws

Laws act on the **lawful world**: sentinel drones, anomaly shards, grenades, energy bolts and bots.
Human players are *lawbreakers*: their own movement, reloads and timers ignore the laws.

- **Gravity** — the reactor anomaly at B is a central field `F ∝ μ/r^n` (exponent clamped 0–3,
  strength −200–200, softened inside 1.5 m) or a uniform field in any direction. Sentinel drones and
  shards orbit the reactor under the default inverse-square law; switch to inverse cube and the orbits
  break and the sentinels escape — clearing the objective without firing a shot. Negative strength
  repels everything. Grenades feel planetary gravity plus the anomaly, so they curve near the reactor.
  Bodies are integrated with a symplectic (velocity-Verlet) integrator at 120 Hz; the inverse-square
  test orbit closes after its analytic Kepler period.
- **Time** — world time advances by `scale × (motion ? clamp(speed/6 m/s, 0, 1) : 1)`. With
  “time only moves when I move”, bots, drones, energy bolts, grenade fuses and capture progress
  freeze while the lawbreaker stands still. Online, the motion that drives time is the law's author.
- **Light** — a screen-space approximation inspired by MIT's *A Slower Speed of Light*: Doppler tint,
  searchlight brightness and aberration from the camera-relative velocity, `v/c` capped at 0.85.
  It is not spectral rendering, time dilation or Lorentz geometry.
- **Rewind** — a bounded 10-second ring of world snapshots (30 Hz). Rewinding restores bots
  (alive or dead, position, health, ammo), lawful bodies and capture progress while every
  lawbreaker keeps moving freely; scores and kills are not rewound. Resuming discards the future.

**How to rewrite:** press `/` and type a sentence. It goes to the server-only route `api/law.ts`,
which asks an LLM for strict structured JSON, then the shared Zod schema in `shared/laws.ts` rejects
unknown keys, non-finite or coerced numbers and clamps every range — a typed command, never code.
The SpacetimeDB module validates the same schema again before applying it. Keys `1`–`4` (and the
four example sentences) work with **no AI credentials**. Without `OPENAI_API_KEY` the route answers
`503` with a presets fallback. Solo/Law Lab: unlimited rewrites, laws persist. Online: 25 s cooldown
per player (halved while your team holds B), laws revert after 30 s, and every player sees a toast
naming who changed what.

## Controls

| Input | Action |
| --- | --- |
| WASD · mouse | Move · look |
| LMB · RMB | Fire · aim down sights |
| Shift · Space | Sprint · jump |
| C or Ctrl | Crouch (while sprinting: slide) |
| R · Q / wheel · G | Reload · swap weapon · throw grenade |
| `/` · `1` `2` `3` `4` | Sentence law editor · presets: cube gravity, motion time, slow light, rewind 5 s |
| Tab · Esc | Scoreboard · release the mouse (pauses solo; click to resume, `M` for the deploy screen) |

## Multiplayer architecture

`spacetimedb/src/index.ts` runs the **same** `shared/match` simulation as solo play, server-side:

- Tables: `match` (phase, scores, laws, map), `soldier` (replicated state), `point`, `body` (drones,
  bolts, grenades, shards), `player` (identity → soldier), private `bot_brain` and `history` (rewind
  ring), an event table `match_event` (shots, damage, kills, captures, law changes), and a 30 Hz
  scheduled `tick` reducer that runs bots, the lawful world, objectives, scoring, respawns, round
  resets and map rotation. With no humans connected the tick idles.
- Clients send their own movement (`report`, 20 Hz) and shots (`fire`) with an optional claimed hit.
  Movement spends a distance budget measured against server time (refills at 14 m/s, capped at
  6 m ≈ 0.7 s of sprinting), so reports that bunch up after a network stall pass but sending reports
  faster never buys distance; rising higher above the last floor than a jump plus a ledge step-up,
  or staying airborne for 2.5 s (longer than any fall on these maps), drops the soldier back down;
  bounds, solid geometry and enemy shields are enforced. Tests drive the real movement controller
  (sprints, slide-hops, jumps, a ledge step-up) through jittered, bunched delivery and expect zero
  corrections. Each shot
  claim is checked for alive shooter, weapon, magazine, fire rate (a client's fire clock may run at
  most 250 ms ahead, so slow weapons get no instant follow-up), origin near the shooter, range, line
  of sight through static geometry, a claimed point within a speed-scaled tolerance of the target's
  hit volumes, and no friendly fire. Damage, kills and scores are authoritative. Drones and bot shots
  are simulated entirely on the server.
- Client-side: own movement is predicted with the shared controller; remote soldiers and bodies are
  interpolated ~100 ms behind; a rejected position snaps the client back; dropped (idle) clients
  rejoin automatically. Online play was verified with two separate browser clients (different
  identities): they see each other move, receive each other's law changes and cooldown errors, and
  fight through server validation — one client killed the other, both kill feeds showed it and the
  victim's death screen named the killer.
- Trust model and limits: movement is client-reported (validated, not simulated), hit detection is
  shooter-favoured within tolerances (no full lag compensation), one match per database, and the
  anonymous AI law route is not rate limited by this code (use Vercel Firewall + an OpenAI spend
  limit before exposing it publicly).

## Run, test and develop

```sh
bun install --frozen-lockfile
bun install --cwd spacetimedb --frozen-lockfile
bun run dev            # Vite dev server (solo and Law Lab work immediately, offline after load)
bun run test           # Vitest (not `bun test`): physics, movement, collision, maps, bots, validation, laws, API
bun run build          # type-check + production build
bun run typecheck:module
```

Online play locally needs the [SpacetimeDB CLI](https://spacetimedb.com/install) (verified with 2.10.2):

```sh
bun run dev:spacetime  # starts a local server on :3000 and (re)publishes the module as "lawbreaker"
VITE_SPACETIMEDB_URI=same-origin VITE_SPACETIMEDB_DATABASE=lawbreaker bun run dev
```

`same-origin` routes the websocket through the dev server at `/stdb`, so a single URL serves the
game and the match server. After changing the module, regenerate client bindings with
`spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb`.
In Amp orbs, `.amp/services.yaml` declares both services (`amp orb services ensure`).

Set `OPENAI_API_KEY` (server-only, never `VITE_`) to enable free-form sentences; `OPENAI_MODEL`
defaults to `gpt-4o-mini`.

Development pages (dev server only): `/dev/level.html?map=verdant` (battlefield preview),
`/dev/soldier.html` (animation/IK pose sheet), `/dev/viewmodel.html?ads=1` (first-person weapon),
`/dev/viewer.html?model=/assets/props.glb` (asset viewer). Dev-only URL flags `debuginput`,
`fixeddt` and `capture` make automated runs deterministic on software renderers.

## Deploy

Production: https://lawbreaker.vercel.app. The private GitHub repository
`madeyexz/lawbreaker` is connected to Vercel project `madeyexzs-projects/lawbreaker`, with
`main` as its shared development and production branch. Maincloud database: `3d-game-c4lhd`
(dashboard: https://spacetimedb.com/3d-game-c4lhd).

Vercel production build variables are `VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com`
and `VITE_SPACETIMEDB_DATABASE=3d-game-c4lhd`. Do not use `same-origin` on Vercel; that proxy
exists only in the development server. `OPENAI_API_KEY` is deliberately absent: presets work,
and free-form AI returns the fallback response without incurring AI charges.

For module updates, run tests and module type checks, then publish non-destructively:

```sh
bun run test && bun run build && bun run typecheck:module
spacetime publish -s maincloud -p spacetimedb --delete-data=never --yes=remote,skip-login 3d-game-c4lhd
```

Stop if schema changes require deletion; never use the local development script for cloud
publication. On an existing empty starter database, the first valid join initializes the match
atomically; subsequent joins preserve its state. Publish the compatible module before pushing
the matching commit to `main`, which triggers Vercel's GitHub deployment.
Verify the production URL and two separate Online clients after each release.

## Assets and licenses

No proprietary game assets are used. Everything is original code or CC0/OFL:

- Characters, animations, weapons, drones, props and modular kit pieces/trim sheets: free “Standard”
  editions of Quaternius' *Universal Base Characters*, *Universal Animation Library 1 & 2*,
  *Sci-Fi Essentials Kit* and *Modular Sci-Fi MegaKit* — CC0 1.0 (https://quaternius.com).
  Converted by `tools/import-assets.ts` (textures resized to WebP, animation tracks pruned and
  meshopt-compressed); see `public/assets/LICENSE.txt`.
- Terrain and surface textures: Poly Haven, CC0 1.0, fetched by `tools/fetch-textures.ts`; see
  `public/assets/tex/LICENSE.txt`.
- Font: Rajdhani by Indian Type Foundry, SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
- Sky, planets, terrain, architecture, armor, effects and audio are procedural.
- Engine/libraries: Three.js (MIT), Zod (MIT), Vite (MIT). The `spacetimedb` npm package declares ISC
  but ships the SpacetimeDB Business Source License 1.1 text; the SpacetimeDB server/CLI is BSL 1.1.
  Review those terms before any commercial self-hosting.

The asset tools live in `tools/` with their own `package.json`; the source packs themselves are not
committed.

## Performance

Targets 60 fps on an M-series MacBook at the default *medium* preset (DPR ≤ 1, 2048 shadow map,
half-resolution bloom). Budgets: merged static geometry per material, one draw call set per soldier
(body + 3-part armor + weapon), at most four dynamic point lights (reactor + three pooled flashes),
pooled effects. A typical firefight frame is ~150–420 draw calls and ~0.5 M triangles. **The 60 fps
target has not been measured on Apple hardware**: development ran in a cloud sandbox whose browser
renders with SwiftShader (CPU), where the game runs at about 3 fps, so no frame-rate claim is made.

**Measure it yourself:** click *Run the 30-second performance check* on the deploy screen (or open
`/?bench`, optionally `&map=frostline&quality=high`). A scripted soldier runs the objective route
and fights through a solo skirmish for 30 s after a warm-up, then a panel reports average fps,
1% low, frame-time median/p95/p99, frames slower than 60 Hz, main-thread time per frame, hitches
over 100 ms, shader compiles during the run, draw calls, triangles, resolution and the GPU string,
with a verdict (met = average ≥ 58 fps and p95 ≤ 18.2 ms) and a *Copy results* button (JSON).
Browsers cap frames at the display refresh rate, so 120 Hz screens can exceed 60. The deploy screen
also has Low / Medium / High graphics presets (`?quality=` works too).

## Known limitations and what remains

- No full lag compensation or server-side rewind for hit validation; very high latency can make
  moving targets harder to hit or let claims fail validation.
- Movement is client-reported (validated). A determined cheater could still play within the
  limits the server allows (up to ~1.6× sprint speed sustained, short 6 m bursts, aim assistance).
- One match per database; no lobbies, parties, persistent progression or matchmaking.
- First-person and third-person animation is code-driven on CC0 clips; there are no authored
  rifle-specific reload/hit animations, and fingers are posed procedurally.
- Audio is synthesized; there are no recorded weapon samples.
- Online law changes are global and temporary by design; motion-driven time online follows the
  author's movement only.
- Mobile/touch is not supported. Not tested on Safari/Firefox in this environment.

## 60-second demo script — one continuous shot

1. **0–6 s** — Deploy screen: choose *Solo skirmish*, *Cinder Basin*, *Assault*, *Veteran*. Click
   **Deploy**. Say: “A real frontline — and the laws are on the table.”
2. **6–20 s** — Sprint out of the warpgate (Shift), slide behind cover at A (C while sprinting), ADS
   (RMB) and win a firefight with the carbine: hit markers, a kill confirm, the kill feed.
3. **20–28 s** — Push to the ridge over B. Point at the sentinel drones orbiting the reactor with
   their trails. Say: “They're bound by inverse-square gravity.”
4. **28–36 s** — Press **1**. Watch the orbits break and the sentinels fly off; the laws panel and
   toast update. Say: “Change one exponent and the defense falls apart.”
5. **36–42 s** — Press **4**. The world rewinds five seconds — drones return, a downed bot stands
   back up — while you keep moving.
6. **42–52 s** — Press **2**, throw a grenade (G) and stand still: the grenade, the drones and the
   enemy freeze in mid-air. Step forward and time resumes. Say: “Time is waiting for me.”
7. **52–60 s** — Press **/** and type “light travels at walking speed” (works offline as an example),
   sprint and watch the Doppler shift. Finish: “The rules of war are yours to rewrite.”

For the online version, open the game in two browsers, choose *Online match* in both, and repeat
steps 2–4: the second player sees the first player's law change and toast immediately.

## Project layout

```
shared/        Pure TypeScript shared by browser, tests and the SpacetimeDB module
  laws.ts        Zod law schema (validation + clamping)
  collision.ts   AABB/ramp/heightfield world, raycasts, cylinder resolution
  movement.ts    Infantry controller        hitbox.ts  hit volumes      weapons.ts  tuning
  world.ts       Lawful bodies, gravity/time integration, rewind ring
  maps/          Builder + Cinder Basin, Frostline Reach, Verdant Divide, Ochre Quarter
  match/         State, simulation tick, combat validation, bots, navigation
src/           Browser client: game loop, prediction, rendering, view model, soldiers, HUD, audio, net
spacetimedb/   SpacetimeDB module (tables, scheduled tick, validated reducers)
api/law.ts     Server-only natural-language → typed law route
tools/         Reproducible CC0 asset import and texture fetch scripts
dev/           Development preview pages
```

## References

[Einstein's Dreams](https://en.wikipedia.org/wiki/Einstein%27s_Dreams) ·
[Bertrand's theorem](https://en.wikipedia.org/wiki/Bertrand%27s_theorem) ·
[MIT: A Slower Speed of Light](https://gamelab.mit.edu/games/a-slower-speed-of-light/) ·
[SpacetimeDB](https://spacetimedb.com/docs/) · [Three.js](https://threejs.org) ·
[Quaternius](https://quaternius.com) · [Poly Haven](https://polyhaven.com)
