# Gameplay reference

Everything in the game, with the numbers: modes and rounds, the economy, weapons, attachments, every
map, the vehicles and the controls. The rules follow **BeGone** (nPlay's browser FPS); `shared/weapons.ts`
and `shared/match/economy.ts` cite its numbers.

Back to the [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)

## What is in the game

| Area | Implemented |
| --- | --- |
| Lobby | Callsign and team at the top, then three tabs. **Quick play** (the default) has one big button: it joins the fullest open public room of any size, map or mode (`quick_any`; full and private rooms never), or opens a public 6v6 with bots on a random map and mode; the line under it says which ("Joins Taipei · 6v6 · 5/12" or "Opens a new 6v6 room with bots") with the ping. Under it, every live public room is listed as in Join a server, without filters, the room Quick play would join outlined. **Start a server** is a form: game type (Elimination / Sabotage), size (1v1 / 6v6 / 24v24), map (the picker's cards with a plan of the map, its region or bomb sites and who is playing there, filtered to maps the size and mode can host, or a shortcut beside it), visibility (Public: listed and filled by Quick Play, keeps its map and mode; Private: a 4-letter code shown in game) and bots (on / off), then START (`start_room`); the form is remembered, and a map the size or mode cannot host moves to the first one that can, with a note. **Join a server** lists every live public room (map and round, mode, size, players, ping, Join; full rooms greyed with FULL; joinable first, then the most players, then the lowest ping; a lock when the map or mode is fixed), with header totals and the server's region and ping, optional size and mode filters (All by default; the foot counts the rooms they hide), and a private room code box. Ping (`src/net/ping.ts`): `GET /v1/ping` on the SpacetimeDB host every 4 s while the lobby is visible, the handshake sample dropped, median of the last 5; green under 80 ms, amber under 160, red beyond; per server URI, so every room shows the one Maincloud database's ping today. Under all three: *Solo vs bots* (the form's mode, size and map; bot difficulty) and *Practice* (the form's map; no bots, free store). Options: language (English / 繁體中文), graphics, crosshair, scope view, reticle, sensitivity and aim sensitivity, field of view, volume, controls. The ? button opens the Controls tab where every key can be rebound (see [Controls](#controls)). In a match, Esc or P opens the same settings (Options and Controls tabs); F toggles fullscreen. |
| Language | English and Traditional Chinese (Taiwan, 繁體中文): every lobby, settings, HUD, store, scoreboard and end-of-match string (`src/ui/i18n.ts`; SWAT 特警, Militia 民兵, Elimination 殲滅戰, Sabotage 爆破戰, maps by their Chinese names such as 西門町 and 台北101・信義; guns keep their real names). It follows the browser (zh-TW, zh-HK, zh-Hant read Chinese) until a choice is saved in Settings; `?lang=zh-TW` / `?lang=en` overrides it for the visit. Switching applies at once, in the lobby and in a match; kill-feed lines and toasts already on screen keep their language until they fade. Text the server sends (cash award reasons, room errors) stays English on the wire and is translated in the client. |
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
| Vehicles | Cars and taxis, Taiwanese scooters and a light helicopter on Taipei and Meridian District (see [Vehicles](#vehicles)): E to get in or out, arcade driving and flying, chase camera, run-overs, body damage and wrecks; parked back at their spots every round. |
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

Twelve maps are offered today. Crane, Tower, Courtyard, Cinder Basin, Frostline Reach and Verdant
Divide are retired (`RETIRED_MAPS` in `shared/maps/index.ts`): still defined and loadable with
`?map=`, but offered nowhere. All are described below.

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

**Taipei** is Ximending (西門町) from the browser game *臺北狂飆 / TAIPEI RUSH*
(https://taipei-gta.vercel.app) by @aicodewithme: the source's street plan,
building volumes and collision boxes, shop and blade signs, rooftop billboards, the Ximen gateway,
the walk-in cinema lobby and game arcade, the arcades (騎樓) of the blocks along Zhongxiao W. Rd, the
median hedges, the Civic Blvd expressway and the Red House, around the spot where that game starts
its player. `tools/import-taipei.ts` regenerates `shared/maps/taipei-data.ts` from that game's built
JavaScript; its header explains how. The same tool also exports what the source *draws*: the
district's own meshes and canvas atlas (facades, shopfronts, signs, AC units, the cinema and arcade
interiors: `public/assets/taipei-district.glb`, `taipei-atlas.webp`), its street furniture run through
the source's own street generator (trees, lamps, traffic signals and street-name plates, bus stops,
YouBike docks, bollards, hydrants, postboxes, planters, rows of parked scooters, traffic signs:
`shared/maps/taipei-street.ts`, with the colliders in `taipei-furniture.ts`), the source's prop meshes
(`public/assets/taipei-props.json`), Ximen station's exit 6, and the city past the backdrop
(`taipei-skyline.ts`: its buildings out to 1.3 km, landmarks, hills and roads), where Taipei 101 stands
at the source's site, 1.6 km east-southeast, as a detailed 508 m model with its gold-lit segments.
The renderer loads these on demand (`src/render/dressing.ts`, `skyline.ts`, `lotdetail.ts`), so the
server and the other maps never carry them.

The game plays a compact cut of it (`taipei-compact.ts`, 162.5 × 133.5 m, Squad rooms): the nine
blocks round Cinema Street and the arcade, ringed by a road made of one carriageway of each boulevard
(Civic Blvd under the expressway, Huanhe Rd, Zhongxiao W. Rd, Zhonghua Rd). The far carriageways, the
Red House and the city are backdrop past median fences and a lane closure. SWAT deploys behind a
police cordon on Civic Blvd's sidewalk, in two squads by its west and east doors with the Ximen Mall
through the block as its third way out; Militia behind a barricade in Xining S. Rd, out north across
Emei St or through the shops either side. The bomb sites are A, Cinema Street (電影街), and B, the
Tomas Bear arcade (湯瑪熊歡樂城); the bases are about 115 m apart on foot and SWAT's nearest squad
reaches either site about two seconds (sprinting) before Militia's. Over the source:
- passages through the blocks (`taipei-passages.ts`, on `taipei-interiors.ts`'s shop machinery): the
  mall, a karaoke house (KTV) behind the 7-TWELVE with a second storey over site B, a run of shops south
  of Emei St from the barricade to Hanzhong St, the cinema's back corridor from Emei St into its lobby
  on Cinema Street, a tea house upstairs over Xining S. Rd, and a board-game café into the arcade's
  back; plus the enterable 7-TWELVEs, claw-machine shop, 51嵐 tea shop and figure shop;
- level changes (`taipei-heights.ts`): the cinema balcony over site A up stairs at both ends, a
  plank bridge from the KTV's upper floor across Hanzhong St to a canopy over the arcade's front, the
  two 7-TWELVE roofs (the helicopter's pad, a ladder shaft) joined by a covered skybridge over Emei
  St, the scaffold on Xining S. Rd and the container site office, and sign gantries over the streets
  that cut the long views from up there;
- street cover (`taipei-cover.ts`, `taipei-streets.ts`): the covered night market (西門夜市) on Wuchang
  St, the temple stage (廟口戲台), a walled roadwork and a construction compound, kiosks in every
  crossing, booths across the ring road's sidewalks, stalls, vans, a box truck, crates and barriers.
Emei St is the cut-through for cars: its lane swings from one side of the street to the other at
three bends, with the street's cover on the side it is not using. Everything sits on the bots' 2.5 m
navigation grid (bots walk every passage, stair, deck, bridge and roof), and no eye-level line
between two places a soldier can stand runs longer than 60 m except along the ring road's drive
lanes (the old full-size map's ran to 243 m; `shared/maps/taipei.test.ts` checks every node pair).
Parked cars and taxis stand in the source's car bays off the drive lanes. Approximations: medians
follow the junction gaps by rule, the generic buildings' balconies, window cages and rooftops are
drawn by our own rules after the source's, and traffic and pedestrians are not carried over.

**Taipei 101 · Xinyi** (big map, 24v24) is the Xinyi district (信義) around Taipei 101 from the same
game. `tools/import-xinyi.ts` runs that game's city code headless and
writes `shared/maps/xinyi-data.ts`: the street plan (Xinyi, Songren, Heping, Songzhi and Keelung Rds),
the basin's hills, every section of Taipei 101 as the source lofts it (the tapering base, the eight
stacked segments with their lit bands, crown and spire, the ruyi and coin ornaments), the 101 plaza
and podium mall shell, the Xinyi Plaza Malls (信義新天地) and their signs, the Xinyi Skywalk (信義空橋)
with its stairs and piers, the 101 west plaza, Four Four South Village (四四南村) and the city lots.
The source keeps the tower and mall closed; this map opens the podium mall as the centre of the fight:
**A** is the mall atrium, a sunken B1 food court under a ground-floor and a 2F gallery with a bridge
across the void, shops on both sides, stairs between all three floors and a B1 passage out to a new
sunken garden; **B** is the west plaza under the skywalk's spur to the tower, with an MRT exit
pavilion; landmarks C–E are the skywalk, the sunken garden and the village. SWAT deploys in front of
the Xinyi Plaza Malls, Militia on Songzhi Rd; Elephant Mountain's foot (象山) rises along the east edge
(eased toward the edge of the terrain grid). The lots get curtain walls, mullion fins, crowns, lit
canopies and rooftop plant. About 270 × 290 m; the tower itself is scenery (only its base collides).

**Taipei 101 · 88F** (台北101・高樓辦公層; 1v1 and 6v6, Elimination and Sabotage) moves the fight
indoors, onto an office floor near the top of the same tower (`shared/maps/taipei101.ts`). The floor
plate is the tower's notched square, 50 m across at the glass, set at the height (about 383 m) where
the xinyi map's top-segment loft reaches that width, so the segments below the glass come from the
same data. A 3 × 3 plan round a stone core: the Chairman's and CEO's corner suites either side of
the **Sky Lobby** (SWAT steps out of the lifts by the reception and logo wall); **A**, the server room
(two zigzag rows of racks), and **B**, the boardroom, either side of the core; the pantry and the copy
room below them; open offices with desk pods (and two glass meeting rooms in the SE) by the south
glass, and between them the floor under renovation by the fire stairs and freight lift, where Militia
comes up. Three lanes: the west rooms, the east rooms and the core's **damper hall**, where the tuned
mass damper (41 stacked gold plates, 5.8 m across, on eight cables over its hydraulic pedestal) hangs
in a shaft through 89F; a stair either side of the hall climbs to the 89F viewing gallery round the
shaft (glass balustrades higher than a jump), which looks down into the hall. SWAT reaches each site
about 1.8 s ahead of Militia; the bases are about 37 m apart on foot; no eye-level line between two
standing spots exceeds 45 m (`shared/maps/taipei101.test.ts`). Glass stops bullets, as everywhere.
The city below — the shared Taipei skyline (less the 101), Xinyi's lots and a seeded fill of blocks
over the basin's flat ground — is the client-only `taipei101` dressing set (`src/render/cityfill.ts`),
lit by a golden-hour theme (`highrise`) through clear window glass. No vehicles.
**Memorial Hall** (中正紀念堂, 1v1 and 6v6) is a compact arena in and around the National Chiang Kai-shek
Memorial Hall in Taipei, stylised to the game's low-poly look (`shared/maps/memorial*.ts`). The white
hall stands on a three-tier base under its blue glazed octagonal roof: a terrace with marble balustrades
on each tier (4.5, 9 and 13.5 m), the broad 89-step grand staircase up the west face in three flights
(30 + 30 + 29) with a landing at each terrace, a straight rear staircase east and side stairs hugging the
north and south faces. The memorial chamber holds the seated bronze statue on its plinth (a simple,
dignified figure), inscription panels (decorative, not legible), the coffered ceiling with the sun
emblem, the tall bronze doors swung open, honour-guard posts (no figures) and rope lines. The museum
fills the base: the entrance hall under the grand staircase, exhibition rooms with glass and wood
display cases, a lecture hall, a library, the gift shop, the east lobby, and the double-height Gallery
Hall under the upper gallery's balconies, with switchback stairwells (lifts beside them) up into the
chamber. **A** is the Gallery Hall, **B** the chamber before the statue; landmarks C–E are the grand
staircase's upper landing, the north garden and the gift shop. SWAT deploys on the east forecourt,
Militia on the slice of Liberty Square in front of the grand staircase; screen walls with one
gateway each and spirit screens close the bases off from the gardens, which are rooms of clipped hedge
with pines, a pavilion and a lotus pond. The National Theater, the National Concert Hall and the Liberty
Square gate stand to the west as backdrop. Golden-hour light. About 130 × 97 m; no vehicles.
`shared/maps/memorial.test.ts` checks that no eye-level line between two places a soldier can stand
runs longer than 55 m except down the grand staircase's axis, that SWAT reaches each site 1.5–2.5 s
ahead of Militia (1.8 s at both), that bots reach every room, floor, terrace, stair and garden, and that
Militia bots arm each site. Because B is above A, a site is armed and disarmed only on its own floor
(within 2.5 m of the site's height, `onSite` in `shared/match/combat.ts`), and bots plan toward their
goal's floor.

Every map has ammo crates (one more stands in each base) and open team bases. Sabotage lists only the
maps with bomb sites.

### Vehicles

Maps can park drivable vehicles (`MapDef.vehicles`, placed with the builder's `vehicle(...)`):

| Map | Vehicles |
| --- | --- |
| **Taipei** (`shared/maps/taipei-vehicles.ts`) | Two cars on the ring road behind each base (Civic Blvd and Zhongxiao W. Rd) and two more on its Huanhe and Zhonghua Rd sides; scooters in the cordon's kerb lane, outside the barricade and in Xining S. Rd and Hanzhong St; a helicopter on a painted pad on the 7-TWELVE roof in the middle of the map, up its stair house |
| **Meridian District** | On each base boulevard: two cars, two scooters and a helicopter |
| **Taipei 101 · Xinyi** (`shared/maps/xinyi-vehicles.ts`) | Two cars by each base (Xinyi Rd in front of the malls; Heping Rd by Songzhi Rd) and one on Songren Rd; scooters on the malls' frontage, on Songzhi Rd and by the 101 west plaza; a helicopter on a painted pad in Xinyi Rd's eastbound lanes past Songren Rd |

| Vehicle | Seats | Top speed | Body | Notes |
| --- | --- | --- | --- | --- |
| Car / taxi | Driver + passenger | 94 km/h | 520 | Crew is inside: shots and blasts hit the body. Runs enemies over. Drifts on the handbrake |
| Scooter | Rider + pillion | 76 km/h | 160 | Riders are exposed and can be shot off it. The rider shoots one-handed. Leans into turns; slides lighter on the handbrake |
| Helicopter | Pilot + passenger | 122 km/h, climbs 9 m/s | 800 | Rotor spins up for 1.6 s before it lifts; hovers when idle; ceiling 160 m; no bailing out above 40 m |

Car and helicopter drivers cannot shoot or throw; passengers can. A scooter rider steers with one
hand and shoots with the other: pistols and SMGs only (mounting with a rifle, shotgun, sniper or LMG
in hand draws the secondary), from the hip with extra spread and kick, no aiming down sights,
binoculars or grenades. The mouse aims independently of the steering: while you aim (or fire) the
camera holds its direction as the bike turns under it, and swings back behind the bike a moment
after you stop; the crosshair is the camera's centre in both the chase and first-person views.
Riders' legs stay on the bike while the torso turns to the aim (for everyone watching too).

Holding the handbrake (Space) through a turn at speed drifts a car or a scooter: rear grip drops, the
body swings round faster than its velocity, so it slides at an angle; speed bleeds gently; counter-
steer (or letting go) catches the slide. Sliding tyres screech, smoke and lay dark marks on the road.
The drift is part of the shared deterministic physics, so the server's checks accept it as they do
any driving. A body reduced to 0 wrecks: it explodes (7 m blast),
kills its crew and stays as a charred hulk until the round ends. Crashes (speed lost against walls,
hard landings, a pilotless helicopter falling) damage the body. A driven car or scooter faster than
6 m/s hurts enemies it touches. No friendly fire on a crewed vehicle; an empty one is fair game.
Vehicles are solid (`blocks` in `shared/vehicles.ts`, oriented boxes in `shared/obstacles.ts`): a
car's lower body and cabin, a scooter's small box, the helicopter's cabin and tail boom (crouch to
pass under it; the rotor never collides). Soldiers stop against them, jump onto them and stand on
their roofs (a moving vehicle drives out from under them; riding on one is not supported), and a
moving vehicle pushes them aside, shoving them off their feet above 6 m/s. Vehicles bounce off each
other, sharing the impact by mass (crash damage as against walls); a rammed driverless vehicle is
shoved by the host. Grenades bounce off them. Bots plan round vehicles at their parking spots (the
navigation grid counts them as solids) and steer round them wherever they are. Scooter riders stay
seated facing the bike: the torso twists toward the aim at most about 60°, the arms bring the
weapon round. Models are built procedurally (`src/render/vehicles.ts`); engines, the scooter's buzz and
the rotor chop are synthesized.

## Controls

These are the defaults. **Settings → Controls** (the lobby's gear or ? button, or Esc / P in a match)
rebinds every action: click a key cap, press a key, mouse button or wheel click (Esc cancels); each
action takes a second key in the next column, has its own Reset, and *Reset all to defaults* restores
everything. A key already used where the action works is reported inline with Swap or Cancel
(a swap that would leave an action without a key, or put a key where it clashes, is not offered).
Changes apply at once and every hint follows them (HUD prompts, the vehicle panel, the store, the
menu header, spectating). Bindings are physical key positions (`KeyboardEvent.code`), so AZERTY and
Dvorak keep the same layout of controls, labelled with the keyboard's own letters where the browser
reports them. They are saved per browser under `lawbreaker.keys` (only the changed actions, with a
format version, so later changes to defaults still reach the rest). The action map is
`src/game/keybinds.ts`; every key read in the game goes through it.

Actions belong to contexts: on foot, at the wheel (cars and scooters; a scooter rider also shoots),
flying, the back seat, the store and the menu. Two actions may share a key only when their contexts
never overlap, which is why driving reuses W/A/S/D, Space and C/Ctrl. Reserved: **Esc** (always opens
and closes the menu and cancels a rebind; browsers release the mouse on it), the **Cmd / Windows** keys
(the system's) and **Caps Lock** (it toggles instead of being held). Inside the store the arrows,
digits, Enter, Space and clicks pick and buy, and in the menu clicks, Tab, Enter and Space work the
menu, so actions that also work there cannot use them; the wheel cannot drive held actions or
fullscreen. On touch-only screens the Controls tab is read-only.

| Input | Action |
| --- | --- |
| WASD · mouse | Move · look |
| LMB · RMB | Fire · accuracy (zoom) |
| Shift · Space | Sprint · jump (both cost stamina) |
| C or Ctrl | Crouch |
| 1 · 2 · 3 | Knife · secondary · primary |
| 4 or G | M67 grenade |
| Q or wheel | Cycle weapons |
| R · E | Reload · use (arm or disarm the bomb, ammo crate, get in or out of a vehicle) |
| On a ladder: toward it · away · Space | Climb up · climb down · let go (walk off its top to climb down) |
| Z · B | Binoculars · store |
| Enter · T | Chat · team chat |
| Tab · F | Scoreboard · fullscreen |
| In a car or on a scooter: W · S · A · D · Space | Throttle · brake and reverse · steer · handbrake (drift through a turn) |
| On a scooter: mouse · LMB · R · 1 · 2 · 3 | Aim (independent of the steering) · fire · reload · one-handed weapons only |
| In the helicopter: W · S · A · D · Space · C or Ctrl · mouse | Forward · back · strafe · climb · descend · turn |
| V | Vehicle camera: chase view or the driver's seat |
| Esc or P · M | Menu: release the mouse (pauses solo; Resume or Esc / P to go back) · from the menu, back to the lobby |

## Phones, tablets and the installable app

Touch-primary devices (a coarse pointer or touch points with no mouse, iPads included) get on-screen
controls; **Settings → Controls** switches them Auto / On / Off (`?touch=1|0` for testing) and sets the
finger look speed (0.3×–8× on a logarithmic slider; default 2.00×: a swipe across an iPhone SE's width
turns about 270°, 340° on an iPhone 14; aiming scales it by the zoom like the mouse). The left part of the screen is a floating stick
(it appears under the thumb; past its ring you sprint; in a vehicle it is throttle, brake and steering),
the rest is a look pad, and fire also looks while held. **Auto-aim when firing** (on by default,
`src/game/holdfire.ts`): a tap on fire shoots from the hip at once, holding it past 150 ms raises the
sights while it keeps firing, and letting go lowers them; the M110 sniper instead raises its scope while
held and fires one aimed shot on release (a quick tap fires from the hip). The knife, binoculars, a
grenade throw, a scooter rider and a toggled Aim keep the plain trigger; the Aim button still works on
its own. Buttons press the same actions as keys (`src/game/touchlayout.ts` →
`Input.touchHeld` / `touchPress`), and only those that matter are shown: Use appears near a vehicle,
crate or bomb site (hold it to arm or defuse), vehicle buttons replace the on-foot ones while seated, a
scooter rider keeps fire and the one-handed guns, and the dead get Next. Quick chat opens the keyboard
on Type. **Edit touch layout** (Settings → Controls) drags, pinches or slides to resize, hides, sets
opacity, assigns two custom slots any action, swaps to left-handed and resets; it is saved in the browser
(versioned, only the changes). Phones start on Low graphics, ask for landscape during a
match, request fullscreen on Android, and keep page scroll, zoom and long-press menus off in play.

The game installs as a web app: `public/manifest.webmanifest` (fullscreen, landscape, icons from
`bun tools/make-icons.ts`), iOS home-screen meta tags, and a service worker (`src/pwa/sw.ts`, built to
`/sw.js` with this build's file list) that fetches the page network-first, serves this build's files and
the models, textures and sounds from caches versioned by the build and by `public/`'s contents, and
never touches SpacetimeDB, its ping, PostHog or `/admin`. Phone visitors see an install hint in the
lobby (Install where the browser offers it, Share → Add to Home Screen on iOS) until they dismiss it.
