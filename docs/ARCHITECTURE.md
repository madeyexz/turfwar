# Architecture

How Online play works (one SpacetimeDB database running the same TypeScript simulation as Solo),
what the server validates, performance budgets, known limits and the project layout. For where new
code belongs, see [CONTRIBUTING.md](../CONTRIBUTING.md#where-code-belongs).

Back to the [README](../README.md) · [Gameplay](GAMEPLAY.md) · [Development](DEVELOPMENT.md)

## Multiplayer architecture

`spacetimedb/src/index.ts` runs the **same** `shared/match` simulation as solo play, server-side:

- Rooms: one database holds many rooms. The `match`, `clock` and `frame` rows are keyed by room id,
  and soldiers, bodies, players, the roster and events carry a `room` column; soldier and body ids
  come from a global `counter`. `quick_any` (Quick Play) puts the caller in the fullest open public room of
  any size, map and mode (`pickAnyRoom`), or opens a public 6v6 with bots on a random map and mode.
  `start_room(size, mode, map, bots, isPublic)` (Start a Server) opens a room with exactly those rules,
  validated like `quick_play` (`startRoomError`): public ones keep their map and mode and are listed and
  matched, private ones get a code. `quick_play(size, mode, map)` (the older lobby's Play Online; '' = any mode or map)
  puts the caller in the fullest public room of that size (1, 6 or 24 per team) whose current mode and
  map match, or opens one with those rules; the server checks the size, the mode and that the size (and
  mode) can play the map, and the choice itself is `pickRoom` in `shared/match/rooms.ts`. `quick_join(size)`
  and `join` (6v6) are the same with any mode and map, kept for older clients. `create_room` opens a
  private room with a 4-letter code and the host's mode, map, size and bots; `join_room(code)` joins it
  (the code lives in the private `room_code` table, never on the public `match` rows: the public
  `private_room` marks which rooms are private, and the `my_room_code` view shows a room's code only to
  its players);
  `join_public(room)` joins a listed public room. Each room has its own `tick_schedule` row while humans
  are in it and closes (rows and schedule deleted) when the last one leaves, so idle rooms cost nothing.
  After each match a public room keeps a map or a mode it was opened for (`fixedMap` / `fixedMode` in
  its config JSON); what was "any" rotates: the next map its size (and a fixed mode) plays, and
  Elimination and Sabotage alternate where the map has bomb sites (`nextRoomRules`). A room on its end
  screen that is about to rotate away no longer matches a filter for its old map or mode. Private rooms
  replay the host's choice. Clients subscribe to `match`, `player` and `profile`, then only their room's
  `roster`, `frame` and `match_event` rows.
- Player reducers only **queue** input: `report` overwrites the soldier's row in a private `inbox`
  (elapsed time accumulates for the movement budget) and `fire`, `grenade`, `reload_weapon`,
  `switch_slot`, `buy`, `buy_attachment`, `use_crate`, `enter_vehicle` and `exit_vehicle` append to a
  private `command` queue; the driver's `vehicle_report` overwrites its row in a private
  `vehicle_inbox`; `say` posts chat. The 30 Hz scheduled `tick` loads the match **once**, applies every queued report
  and command in arrival order through the shared validation (buy window and base for weapons, cash,
  attachment fit, crate reach), runs bots, grenades, the round clock, the bomb, cash awards and map
  rotation, and saves. With no humans connected the tick idles.
- What clients subscribe to: `match` (slow fields only: phase, scores, map, configuration; rewritten
  only when they change), `roster` (name, team, weapons, owned guns and attachments, reserves, cash,
  score line; rewritten only on events), `player` (identity → soldier), `profile` (career stats), the
  event table `match_event` (damage, kills, rounds, bomb, cash awards, chat) and one `frame` row
  rewritten every tick: a packed binary snapshot (`shared/match/frame.ts`) of every soldier's pose and
  vitals, grenades, vehicles (pose, body health, crew, wrecks), the round clock and bomb, and that
  tick's shots. `soldier`, `body` and `vehicle` (per room, keyed by room and map spot) keep
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
- Vehicles follow the same pattern: the driver's client predicts its vehicle with the shared physics
  (`shared/vehicles.ts`) and reports it at 20 Hz; the server accepts it only for the vehicle's own
  driver, within a distance budget from the kind's top speed against server time, in bounds, clear of
  solid geometry, on the floor for cars and scooters, under the ceiling for the helicopter (which
  cannot lift before its rotor has spun up on the server), and not moving during freeze time; a
  rejected report is a correction and the client snaps to the server's pose. Getting in and out
  (reach, free seats, teammates only as passengers, a clear spot beside the vehicle), driverless
  vehicles, crashes, run-overs, body damage and wrecks are server-side. Shot claims on a vehicle use
  target `-2 - index` and are checked against its hit box like soldier claims. A scooter rider's
  report also carries its aim (`aim_yaw`, `aim_pitch`, appended to `vehicle_inbox` with defaults), and
  its shots go through the normal `fire` validation: refused for car and helicopter drivers and for
  two-handed weapons; the claimed origin must lie within 2.5 m (plus 0.1 s of the vehicle's speed)
  of the rider's seated eye, or the server fires from that eye instead.
  `bun scripts/vehiclecheck.ts ws://127.0.0.1:<port> <db>` (local only) drives a car (with a
  handbrake drift round a corner, and a refused shot from the driver's seat), flies the helicopter,
  then rides a scooter through drifts both ways while firing sideways, with two identities. It
  expects zero corrections, every rider shot accepted from its claimed muzzle, the other client
  seeing the vehicles move and the rider turned to its aim, and a rejected teleport.
- Vehicle bodies on the server: a soldier's report may not walk into a vehicle's body (deeper than
  the vehicle's own speed explains, and deeper than where he stood: a vehicle driving onto him is
  not his fault); vehicle roofs count as floors; a moving vehicle nearby adds its speed to the
  movement budget (shoves). A driver's report may not drive into another vehicle's body the same
  way, and a vehicle nearby adds to its budget (pushed). Driving clients bounce off the other
  vehicles' latest replicated poses; the host hands a rammed driverless vehicle the blow (from the
  rammer's velocity at its previous report, by mass) and steps driverless vehicles against the rest.
  `bun scripts/collisioncheck.ts ws://127.0.0.1:<port> <db>` (local only): a driver creeps into
  another client's soldier standing in the road (pushed aside, no corrections either side, never
  inside the car in the server's frames), backs into a parked car (shoved, no corrections), and a
  report inside a parked car is corrected.
- Client-side: own movement is predicted with the shared controller; remote soldiers and grenades
  are interpolated ~100 ms behind from the frame; a rejected position snaps the client back. The
  module drops a human who sends no movement report for 45 s while alive (idle counts only while
  alive: the dead spectate without reporting). A dropped client stops sending inputs at once and
  rejoins its room automatically while other humans hold it; if it is not back within 8 s, or the
  connection is lost, it returns to the lobby with a message.
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

## Performance

Targets 60 fps on an M-series MacBook at the default *medium* preset (DPR ≤ 1, 2048 shadow map,
half-resolution bloom). Budgets: merged static geometry per material, one draw call set per soldier,
at most three dynamic point lights (pooled muzzle/explosion flashes), pooled effects. The light count
never changes mid-match (a new light recompiles every lit shader): both sides' first-person arms and
their flashlights exist from the start, so watching an enemy after death adds none. Once the map's
dressing loads, `Renderer.warm` compiles every shader in the background and uploads every texture two a
frame, so a camera that jumps (death, a new round) does not stall on first sight. Remote soldiers
use a crowd level of detail: off-screen soldiers are hidden and not animated; on screen, full
animation and shadows within 30 m, half-rate animation to 70 m, quarter rate beyond. Remote gunfire
beyond 110 m is not drawn and gunshot audio is limited to 85 m, six voices per frame and 14 ringing at
once (a near shot takes the oldest's place). Every sound leaves the mix when its last source ends
(`src/voices.ts`): Chrome otherwise keeps rendering finished voices until garbage collection, and a long
firefight starved the audio thread into seconds-long dropouts. `?audiodebug` logs the mix's levels,
compressor reduction and audio-clock rate (below 1 means the audio thread is falling behind). The largest
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

- Online has Quick Play, Start a Server (public or private) and a live room list, but no clans, vote kick or
  skill-based matchmaking. All rooms share one database; capacity per database has been measured only locally.
- No full lag compensation or server-side rewind for hit validation; very high latency can make
  moving targets harder to hit or let claims fail validation. Latency spikes and movement
  corrections have been observed.
- Movement is client-reported (validated). A determined cheater could still play within the
  limits the server allows.
- Every client receives every soldier's pose (no interest management), and every tick writes the
  full soldier set to the database's durable log.
- Third-person camera (V) and the toggle/hold options for crouch and accuracy are not implemented.
- First-person and third-person animation is code-driven on CC0 clips; there are no authored
  weapon-specific reload animations, fingers are posed procedurally, and a soldier on a ladder shows
  the airborne pose (the clip library has no climb).
- Reloads, actions, footsteps and impacts are synthesized; only gunshots are recorded.
- Not tested on Safari/Firefox in this environment.

## Project layout

```
shared/        Pure TypeScript shared by browser, tests and the SpacetimeDB module
  collision.ts   AABB/ramp/heightfield world, ladders, raycasts, cylinder resolution
  movement.ts    Infantry controller        hitbox.ts  hit volumes      weapons.ts  roster + attachments
  world.ts       Grenades under gravity
  maps/          Builder + BeGone's six maps (Crane, Tower, Warehouse, Pipeline, Courtyard,
                 Timbertown) and eight originals (Cinder, Frostline, Verdant, Ochre, Citadel,
                 Railyard, Skyline, Meridian), plus Taipei and Taipei 101 · Xinyi (taipei-data.ts and
                 xinyi-data.ts, generated from 臺北狂飆), Taipei 101 · 88F (taipei101.ts)
                 and Memorial Hall (memorial*.ts),
                 with ladders, bomb sites and ammo crates
  match/         State, rounds and bomb, combat validation, economy, bots, navigation, packed frame
src/           Browser client: lobby, game loop, prediction, rendering, view model, soldiers, HUD, store, audio, net
spacetimedb/   SpacetimeDB module (tables, scheduled tick, validated reducers)
scripts/       Local load test and simulation benchmark
tools/         Reproducible CC0 asset import, sound and texture fetch scripts, the Taipei and Xinyi map imports and the Chinese font subset
dev/           Development preview pages
```
