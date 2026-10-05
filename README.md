# Lawbreaker // Frontline

A browser-first, keyboard-and-mouse team shooter faithful to **BeGone** (nPlay's browser FPS):
SWAT against Militia in short rounds with one life each, cash for every kill, a store in your
base with five primaries, two secondaries, a grenade and BeGone's attachments, and two modes,
**Elimination** and **Sabotage**. Play solo on your own server with bots, on the live server
through SpacetimeDB, or alone on the practice range, on BeGone's six maps (rebuilt as homages) and
eight original battlefields.

Built with Vite, TypeScript, Three.js and SpacetimeDB. Bun is the package manager and script
runner (`bun` / `bunx`, never npm/npx).

## What is in the game

| Area | Implemented |
| --- | --- |
| Lobby | Callsign and team, then **Play online**: pick 1v1 / 6v6 / 24v24 and press **Quick Play** (the fullest public room of that size, or a new one), or open *Create private room* (mode, map, bots; you get a 4-letter code) / *Join with code*. A live **Public rooms** list on the right joins any open room directly. **Play offline**: *Play vs bots* (mode, size, map, difficulty) or *Practice range* (no bots, free store). Options: graphics, crosshair, scope view, reticle, sensitivity and aim sensitivity, field of view, volume, controls. In a match, Esc or P opens the same settings; F toggles fullscreen. |
| Teams | **SWAT** (team 0, navy tactical kit) and **Militia** (team 1, desert and olive irregulars). In Sabotage Militia attacks and SWAT defends. No friendly fire. |
| Rounds | 4 s freeze at round start (buy, no moving), the round, a 5 s round-over pause; first team to **10 round wins** takes the match, then 10 s on the result screen and a new match. Nobody respawns inside a round; everyone respawns at the next round start. Dead players spectate their killer immediately (RMB cycles players); their chat is hidden from the living. |
| Elimination `[E]` | 120 s rounds. Kill the whole other team. If time runs out with both teams alive the round is a draw: it replays and nobody scores. When the last two players trade kills the team that killed last wins. |
| Sabotage `[S]` | 90 s rounds (120 s on single-site maps). Militia holds **E** for 5 s at site A or B to arm the bomb (no moving, shooting or aiming while arming; crouching is allowed). Arming sets the clock to 40 s and the other site goes inert; from then SWAT can only win by disarming (E for 5 s) — killing every Militia no longer ends the round — and the bomb going off wins it for Militia. Before arming: all SWAT dead → Militia win; all Militia dead or time out → SWAT win. No draws. |
| Room sizes | Duel 1v1 · Squad 6v6 · War 24v24 (big maps only: Meridian, bases padded to 24 slots). Bots fill every slot without a human (private rooms can turn them off). |
| Player | 100 health, no armor or regeneration within a round, fall damage, head/body/limb damage per weapon. Below 25 health the screen desaturates and a heartbeat plays that nearby players hear too. Stamina 100: sprinting drains 18/s (5 to start), a jump costs 20, it regenerates 18/s (24 crouched); at 30 or less you cannot sprint. Each weapon sets your move speed. |
| Economy | See the table below. **B** opens the store inside your own base during the first 20 s of a round (freeze time included); dead players can buy for their next spawn. Weapons you own swap free during that window. Attachments can be bought anywhere, at any time. Weapons and attachments last the whole match and reset with a new one. Ammo crates on every map refill about half a magazine of the held weapon's reserve per use (E): the first use in a round costs $300, later ones are free. |
| Gunplay | Hitscan with BeGone's per-weapon numbers: fire rate, magazine and reserve, reload and equip times, hip/zoomed accuracy and recoil, zoom and move speed. RMB is "Accuracy": hold to zoom through the fitted optic (iron sights 3.5×). The knife hits for 33 anywhere at about 2 m. The M1014 fires 14 pellets. The M67 has a 2.1 s fuse and 22 m radius. **Z** raises binoculars (10× zoom, no weapon). |
| Feel | First-person arms posed by IK onto CC0 gun models with optics that follow the fitted attachment (irons, reflex, holographic, ACOG, x4, x6), suppressor, laser and flashlight visuals; procedural sway, bob, kick, sprint carry, reloads and equips; muzzle flash, tracers (hidden when suppressed), impacts, explosions; hit markers, cash popups, damage arrows, kill feed, round banners; recorded CC0 gunshots per weapon (distance-muffled and panned, muffled when suppressed), knife, bomb, round and cash cues, footsteps and a 60-second menu theme sequenced from the game's own effects. |
| Characters | CC0 rigged soldiers in two team outfits, CC0 animation library retargeted by bone name: idle/walk/jog/sprint/crouch/jump/death blend by speed, strafing leg twist, aim pitch, two-bone arm IK onto the weapon, a knife stab, hit flinches. |
| Bots | Navigation grid per map (roofs, catwalks, stairs), A* paths, field of view and line of sight, reaction delays, aim error that settles, strafing, bursts, reloads and grenades. They shop at round start (the best primary they can afford, sometimes an optic and a grenade). In Sabotage Militia bots head for a site and arm it, SWAT bots spread over the sites, and everyone converges on an armed bomb. |
| HUD | Score bar with the round clock, round score and an avatar per soldier (alive or dead, teammates' health), health and stamina, cash, weapon with its attachments, ammo and reserve, grenade, bomb status and arming progress, minimap with sites and crates, kill feed, chat (Enter all, T team), scoreboard (Tab), crosshair that widens with sustained fire, jumping and sprinting in four styles (classic, dot, circle, T), match result. |
| Profiles | Online, each identity keeps career stats (kills, deaths, assists, headshots, rounds and matches played and won) in a public `profile` table. |

### Economy (BeGone's cash awards)

| Award | Cash |
| --- | --- |
| New match (starting money) | $1,000 |
| Kill · knife kill · grenade kill | $500 · $600 · $900 |
| First kill of the round · first blood (first damage) · last enemy alive | +$300 each |
| Multi-kill (kills under 4 s apart) | +$300 × kills in the chain |
| Kill streak | +$100 × (streak ÷ 5) on every 5th kill |
| Headshot | +$100 per headshot bullet (at most 3 per opponent per round) |
| Assist (damaged the victim in its last 3 s) · trade (both kill each other) | $200 · +$100 |
| Arm or disarm the bomb | $500 |
| Round won (each player) · survived · last man standing | $500 · $200 · $300 |
| Loss bonus (4th loss in a row onward) | $500 per loss |
| Loyalty (every 5 rounds on the same server) | $1,000 |
| Maximum | $16,000 |

### Weapons

| Slot (key) | Weapon | Price | Damage head / body / limb | Notes |
| --- | --- | --- | --- | --- |
| Melee (1) | Knife | free | 33 / 33 / 33 | Always carried; 2 swings/s; fastest movement |
| Secondary (2) | M9A1 | default | 29 / 22 / 15 | Semi-auto, 12 + 36 |
| Secondary (2) | MP7 | $1,800 | 18 / 12 / 8 | Automatic, 13 rounds/s, 20 + 60 |
| Primary (3) | MP5 | default | 30 / 18 / 12 | Automatic, 12 rounds/s, 32 + 96 |
| Primary (3) | M4A1 | $3,400 | 33 / 21 / 15 | Automatic, 9 rounds/s, 30 + 90 |
| Primary (3) | M1014 | $2,800 | 24 / 10 / 8 per pellet | Semi-auto shotgun, 14 pellets, 6 + 18 |
| Primary (3) | M110 | $4,000 | 90 / 40 / 30 | Semi-auto marksman rifle, 6 + 18 |
| Primary (3) | M249 | $3,800 | 43 / 33 / 21 | Automatic, 86 + 86, slowest movement |
| Tactical (4 / G) | M67 grenade | $1,000 | 70 (falloff) | One carried, not restocked; High Explosive mod $1,500 (+45 body damage, smaller radius) |

### Attachments (one per category per weapon; kept for the match)

| Category | Attachment | Price | Fits |
| --- | --- | --- | --- |
| Optic | Iron Sight · Reflex · Holographic · ACOG | free · $800 · $1,000 · $1,100 | All firearms (no ACOG on the M9A1) |
| Optic | Zoom x4 · Zoom x6 | $600 · $1,200 | M9A1 only · M110 only |
| Tactical | Ammo Counter · Laser Sight · Flashlight | $200 · $800 · $600 | All firearms |
| Tactical | Suppressor | $1,100 (MP7 $1,000, M9A1 $600) | All firearms: less recoil and damage, no tracer or muzzle flash, quieter |
| Mod | Extended Clip · Recoil Pad | $900 · $1,200 | All firearms |
| Ammo | Explosive · Incendiary | $1,600 · $1,400 | All firearms: more damage, smaller magazine, more recoil |

### Maps

**BeGone's six maps** come first in every map list, rebuilt from the originals' top-down layouts
and wiki descriptions with our own geometry and CC0 textures (brick, planks, corrugated iron, mossy
plaster, cobblestone). Ladders stand where BeGone had them, and stairs were added beside them.

| Map | Size, light | Modes | Landmarks |
| --- | --- | --- | --- |
| **Crane** | Large and open, dusk | [E] · [S] A Ammo house, B SWAT base | Militia building and its roof, tank platform and L fence, the Silo, the fallen crane, broken house, trench, SWAT gantry, helicopter |
| **Tower** | Mid-sized, dusk | [E] | Militia warehouse with its broken window, the catwalk, the Roof, the round brick tower and its crow's nest, containers, ammo house, clockhouse, fence |
| **Warehouse** | One crate hall, snow outside | [E] | Crate maze, the bridge (two offset lanes, team boxes, the ammo crate), sniping decks over both bays |
| **Pipeline** | The largest, meadow | [E] · [S] A Ammo, B SWAT base | The pipe and the hole under it, Militia shed and its L roof, the three connected buildings and their roof, tunnel house, ditch, SWAT ridge and valley |
| **Courtyard** | The smallest, blue hour | [E] | Four pools with flamingo statues, hedges, the statue with the ammo crate, climbable crate stacks, team crates in the corner bases |
| **Timbertown** | Large but plays medium, dry steppe | [E] · [S] one site, by the cabin | Militia hills and log stack, the Militia and SWAT roofs, the platform, garage, alleys, the cabin |

Crane, Tower, Pipeline and Timbertown keep their originals' asymmetry; Warehouse and Courtyard are
mirrored, as BeGone's were.

**The original battlefields**: **Cinder Basin** (desert outpost), **Frostline Reach** (arctic relay
courtyard), **Verdant Divide** (jungle uplink plateau), **Ochre Quarter** (desert old town: an original
homage to the classic two-site layout of CS:GO's Dust II, built from our own geometry and CC0 assets),
**Citadel Keep** (hilltop castle), **Railyard** (freight yard), **Skyline Rooftops** (rooftops high
above a city; the street is fatal) and **Meridian District** (a large war-torn city quarter), each with
bomb sites (two on Ochre Quarter and Meridian District, one elsewhere).

Every map has ammo crates (one more stands in each base) and open team bases. Sabotage lists only the
maps with bomb sites.

## Controls

| Input | Action |
| --- | --- |
| WASD · mouse | Move · look |
| LMB · RMB | Fire · accuracy (zoom) |
| Shift · Space | Sprint · jump (both cost stamina) |
| C or Ctrl | Crouch |
| 1 · 2 · 3 | Knife · secondary · primary |
| 4 or G | M67 grenade |
| Q or wheel | Cycle weapons |
| R · E | Reload · use (arm or disarm the bomb, ammo crate) |
| On a ladder: toward it · away · Space | Climb up · climb down · let go (walk off its top to climb down) |
| Z · B | Binoculars · store |
| Enter · T | Chat · team chat |
| Tab · F | Scoreboard · fullscreen |
| V | Camera view (reserved) |
| Esc · M | Release the mouse (pauses solo; click to resume) · back to the lobby |

## Multiplayer architecture

`spacetimedb/src/index.ts` runs the **same** `shared/match` simulation as solo play, server-side:

- Rooms: one database holds many rooms. The `match`, `clock` and `frame` rows are keyed by room id,
  and soldiers, bodies, players, the roster and events carry a `room` column; soldier and body ids
  come from a global `counter`. `quick_join(size)` puts the caller in the fullest public room of that
  size (1, 6 or 24 per team) or opens one; `create_room` opens a private room with a 4-letter code and
  the host's mode, map, size and bots; `join_room(code)` joins it (`join` is Quick Play 6v6 for older
  clients). Each room has its own `tick_schedule` row while humans are in it and closes (rows and
  schedule deleted) when the last one leaves, so idle rooms cost nothing. Public rooms move to the next
  map their size plays and alternate Elimination and Sabotage after each match; private rooms replay
  the host's choice. Clients subscribe to `match`, `player` and `profile`, then only their room's
  `roster`, `frame` and `match_event` rows.
- Player reducers only **queue** input: `report` overwrites the soldier's row in a private `inbox`
  (elapsed time accumulates for the movement budget) and `fire`, `grenade`, `reload_weapon`,
  `switch_slot`, `buy`, `buy_attachment` and `use_crate` append to a private `command` queue;
  `say` posts chat. The 30 Hz scheduled `tick` loads the match **once**, applies every queued report
  and command in arrival order through the shared validation (buy window and base for weapons, cash,
  attachment fit, crate reach), runs bots, grenades, the round clock, the bomb, cash awards and map
  rotation, and saves. With no humans connected the tick idles.
- What clients subscribe to: `match` (slow fields only: phase, scores, map, configuration; rewritten
  only when they change), `roster` (name, team, weapons, owned guns and attachments, reserves, cash,
  score line; rewritten only on events), `player` (identity → soldier), `profile` (career stats), the
  event table `match_event` (damage, kills, rounds, bomb, cash awards, chat) and one `frame` row
  rewritten every tick: a packed binary snapshot (`shared/match/frame.ts`) of every soldier's pose and
  vitals, grenades, the round clock and bomb, and that tick's shots. `soldier` and `body` keep
  full-precision server state and are not subscribed to; per-tick bookkeeping lives in a private
  `clock` row. Older tables and columns (`point`, `history`, the law columns) remain, unused and
  written neutral, so an existing database migrates in place.
- Clients send their own movement (`report`, 20 Hz) and shots (`fire`) with an optional claimed hit.
  Movement spends a distance budget measured against server time, so bunched reports after a network
  stall pass but sending reports faster never buys distance; climbing higher than a jump plus a ledge
  step-up or staying airborne too long drops the soldier back down, except on a ladder, which holds a
  climbing soldier up (only within reach of its rungs); bounds, solid geometry and the
  other team's base barriers are enforced, and nobody moves during freeze time. Each shot claim is
  checked for alive shooter, weapon, magazine, fire rate, origin near the shooter, range, line of
  sight through static geometry, a claimed point within a speed-scaled tolerance of the target's hit
  volumes, and no friendly fire. Damage, kills, rounds, the bomb, cash, purchases and crates are
  authoritative. Bot shots are simulated entirely on the server.
- Client-side: own movement is predicted with the shared controller; remote soldiers and grenades
  are interpolated ~100 ms behind from the frame; a rejected position snaps the client back; dropped
  (idle) clients rejoin automatically.
- Load test (local only): `bun scripts/loadtest.ts --uri ws://127.0.0.1:3100 --db <name> --clients 100`
  runs headless clients that move with the shared controller, fire validated shots and report the
  server tick rate, bytes per client, report round trips and corrections; it refuses non-local URIs.
  `bun scripts/simbench.ts meridian` times the simulation alone. Measured before the BeGone
  conversion (Domination, 100 clients on Meridian, M3 Pro, local server): 30 ticks/s, ~84 KB/s per
  client, report round trips of 6 / 9 / 12 ms (p50/p95/p99) and zero corrections. These are
  single-machine numbers, not a production load test.
- Trust model and limits: movement is client-reported (validated, not simulated), hit detection is
  shooter-favoured within tolerances (no full lag compensation), and every room shares one database
  (reducers run one at a time), so very many busy rooms will need more databases.

## Run, test and develop

```sh
bun install --frozen-lockfile
bun install --cwd spacetimedb --frozen-lockfile
bun run dev            # Vite dev server (solo and the practice range work immediately, offline after load)
bun run test           # Vitest (not `bun test`): rounds, bomb, economy, weapons, movement, collision, maps, bots, validation
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

Lobby URL flags: `?mode=offline|online|lab`, `&game=elimination|sabotage`,
`&size=duel|squad|war`, `&room=CODE` (Online: join a private room), `&map=<id>`, `&team=0|1|auto`, `&skill=0.25…0.75`,
`&name=…`, `&autostart=1`. Choices are remembered per browser under `lawbreaker.*` in localStorage
(`lawbreaker.crosshair` holds the crosshair style the HUD draws).

Testing the store: the practice range always buys for free, anywhere; add `&freebuy` to the URL for a
free-buy Solo match; for a **local** Online database, set `"freeBuy":true` in the match's
`configJson` with
`spacetime sql <db> "UPDATE match SET configJson = '…' WHERE id = 0" --server http://127.0.0.1:3000`
(owner-only; never on Maincloud).

Development pages (dev server only): `/dev/level.html?map=verdant` (map preview; `&cut=6` clips
everything above 6 m to see under roofs),
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
exists only in the development server.

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

No proprietary game assets are used: the weapon and mode names follow BeGone, but every model,
texture, sound and line of code here is original or CC0/OFL.

- Characters, animations, props and modular kit pieces/trim sheets: free “Standard”
  editions of Quaternius' *Universal Base Characters*, *Universal Animation Library 1 & 2*,
  *Sci-Fi Essentials Kit* and *Modular Sci-Fi MegaKit* — CC0 1.0 (https://quaternius.com).
  Converted by `tools/import-assets.ts` (textures resized to WebP, animation tracks pruned and
  meshopt-compressed); see `public/assets/LICENSE.txt`.
- Weapons: models from Quaternius' *Ultimate Gun Pack* (a bayonet for the knife) — CC0 1.0
  (https://opengameart.org/content/low-poly-guns-pack). Converted from OBJ by `tools/import-guns.ts`
  (`bun tools/import-guns.ts`, with the pack extracted under `GUN_SRC`; `--preview <dir>` renders
  measured side views for placing grips, sights and muzzles) into `public/assets/guns.glb`.
- Gunshots: recordings from *The Free Firearm Sound Library* by Ben Jaszczak, Brian Nelson,
  Kevin Heras and Matthew Nanney — CC0 1.0
  (https://opengameart.org/content/the-free-firearm-sound-library). Each firearm plays two to four
  separate near-distance takes round-robin (M9A1: Walther PPQ, MP7: PPSh, MP5: Carl Gustav M45,
  M4A1: AR-15, M249: AK-47, M1014: Benelli Nova and Winchester Model 12, M110: Tikka T3 and
  Springfield 1917 .30-06), with a mid-distance take per class as the distant layer.
- Reload and handling foley, all CC0 1.0 on OpenGameArt: SpringySpringo's *Gun Reload Sounds*,
  BMacZero's *Gun Reload Sound Effects*, zer0_sol's *Handgun Reload Sound Effect* and *Shotgun
  Reload Sound Effects*, and LFA's *Equipment Clicks III*.
- `tools/fetch-sounds.ts` downloads both, cuts the takes, trims, limits, normalizes and encodes
  them to mono MP3 in `public/assets/sfx` (~570 KB); see `public/assets/sfx/LICENSE.txt`. In game
  (`src/audio.ts`) each shot layers the recording with a synthesized crack and low thump, the
  recorded action, an outdoor tail and casing bounces; remote shots are delayed by distance and
  crossfade to the distant take, and suppressed shots are muffled.
- Terrain and surface textures (including the brick, plank, corrugated-iron, plaster and
  cobblestone architecture of the BeGone maps): Poly Haven, CC0 1.0, fetched by `tools/fetch-textures.ts`; see
  `public/assets/tex/LICENSE.txt`.
- Font: Rajdhani by Indian Type Foundry, SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
- Sky, terrain, architecture, effects and the remaining audio (knife, casings, footsteps,
  explosions, heartbeat, bomb, round and cash cues, UI, and the fallback weapon voices used before
  the recordings load) are procedural.
- Engine/libraries: Three.js (MIT), Vite (MIT). The `spacetimedb` npm package declares ISC
  but ships the SpacetimeDB Business Source License 1.1 text; the SpacetimeDB server/CLI is BSL 1.1.
  Review those terms before any commercial self-hosting.

The asset tools live in `tools/` with their own `package.json`; the source packs themselves are not
committed.

## Performance

Targets 60 fps on an M-series MacBook at the default *medium* preset (DPR ≤ 1, 2048 shadow map,
half-resolution bloom). Budgets: merged static geometry per material, one draw call set per soldier,
at most three dynamic point lights (pooled muzzle/explosion flashes), pooled effects. Remote soldiers
use a crowd level of detail: off-screen soldiers are hidden and not animated; on screen, full
animation and shadows within 30 m, half-rate animation to 70 m, quarter rate beyond. Remote gunfire
beyond 110 m is not drawn and gunshot audio is limited to 85 m and six voices per frame. The largest
room (24v24, 48 soldiers) is lighter than the 100-soldier matches this engine was
measured with (Solo 50v50 on Meridian: 59.9 fps average on an M3 Pro, Chrome, medium).

**Measure it yourself:** click *Run the 30-second performance check* in the lobby options (or open
`/?bench`, optionally `&map=meridian&quality=high&size=war`). A scripted soldier patrols the map and
fights through a solo Elimination match (6v6 unless `size` says otherwise) for 30 s after a
warm-up, then a panel reports average fps, 1% low, frame-time median/p95/p99, frames slower than
60 Hz, main-thread time per frame, hitches over 100 ms, shader compiles during the run, draw calls,
triangles, resolution and the GPU string, with a verdict (met = average ≥ 58 fps and p95 ≤ 18.2 ms)
and a *Copy results* button (JSON). Browsers cap frames at the display refresh rate, so 120 Hz
screens can exceed 60. The lobby also has Low / Medium / High graphics presets (`?quality=` works too).

## Known limitations and what remains

- Online has Quick Play and private rooms but no public room list, clans, vote kick or skill-based
  matchmaking. All rooms share one database; capacity per database has been measured only locally.
- No full lag compensation or server-side rewind for hit validation; very high latency can make
  moving targets harder to hit or let claims fail validation. Latency spikes and movement
  corrections have been observed.
- Movement is client-reported (validated). A determined cheater could still play within the
  limits the server allows.
- Every client receives every soldier's pose (no interest management), and every tick writes the
  full soldier set to the database's durable log.
- Third-person camera (V), key rebinding and the toggle/hold options for crouch and accuracy are not
  implemented.
- First-person and third-person animation is code-driven on CC0 clips; there are no authored
  weapon-specific reload animations, fingers are posed procedurally, and a soldier on a ladder shows
  the airborne pose (the clip library has no climb).
- Reloads, actions, footsteps and impacts are synthesized; only gunshots are recorded.
- Mobile/touch is not supported. Not tested on Safari/Firefox in this environment.

## 60-second demo script — one continuous shot

1. **0–6 s** — Lobby: choose *Solo*, **[S] Sabotage**, room size *6v6*, the *Ochre Quarter*
   row in the server browser, team *Militia*. Click **Start match**.
2. **6–16 s** — Freeze time: press **B** in your base. You start with $1,000 and the MP5 and M9A1;
   open *Attachments* and fit a **Reflex sight** to the MP5 ($800). Close the store.
3. **16–35 s** — Sprint toward site A (Shift; watch stamina), hold RMB to zoom through the reflex and
   win a firefight: hit markers, a kill, "+$500 KILL" and "+$300 FIRST KILL" popups.
4. **35–45 s** — Reach site A and hold **E** for 5 s: the bomb arms, the clock drops to 40 s and the
   bomb beeps. Defend it.
5. **45–60 s** — The bomb goes off or SWAT disarms it: the round banner, round-end cash, and the
   next round's freeze. Press **Tab** for the scoreboard.

For the online version, open the game in two browsers (separate identities) and choose *Online* in
both: each sees the other move, fight, buy and arm, all validated by the server.

## Project layout

```
shared/        Pure TypeScript shared by browser, tests and the SpacetimeDB module
  collision.ts   AABB/ramp/heightfield world, ladders, raycasts, cylinder resolution
  movement.ts    Infantry controller        hitbox.ts  hit volumes      weapons.ts  roster + attachments
  world.ts       Grenades under gravity
  maps/          Builder + BeGone's six maps (Crane, Tower, Warehouse, Pipeline, Courtyard,
                 Timbertown) and eight originals (Cinder, Frostline, Verdant, Ochre, Citadel,
                 Railyard, Skyline, Meridian) with ladders, bomb sites and ammo crates
  match/         State, rounds and bomb, combat validation, economy, bots, navigation, packed frame
src/           Browser client: lobby, game loop, prediction, rendering, view model, soldiers, HUD, store, audio, net
spacetimedb/   SpacetimeDB module (tables, scheduled tick, validated reducers)
scripts/       Local load test and simulation benchmark
tools/         Reproducible CC0 asset import, sound and texture fetch scripts
dev/           Development preview pages
```

## References

[BeGone wiki](https://begone.fandom.com) (rules, numbers and map layouts) · [SpacetimeDB](https://spacetimedb.com/docs/) ·
[Three.js](https://threejs.org) · [Quaternius](https://quaternius.com) · [Poly Haven](https://polyhaven.com)
