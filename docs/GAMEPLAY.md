# Gameplay reference

Everything in the game, with the numbers: modes and rounds, the economy, weapons, attachments, every
map, the vehicles and the controls. The rules follow **BeGone** (nPlay's browser FPS); `shared/weapons.ts`
and `shared/match/economy.ts` cite its numbers.

Back to the [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)

## What is in the game

| Area | Implemented |
| --- | --- |
| Lobby | Callsign and team at the top, then three tabs. **Quick play** (the default) has one big button: it joins the fullest open public room of any size, map or mode (`quick_any`; full and private rooms never), or opens a public 6v6 with bots on a random map and mode; the line under it says which ("Joins Taipei · 6v6 · 5/12" or "Opens a new 6v6 room with bots") beside the server chip (server and ping; it opens the server choice). Under it, every live room is listed as in Join a server, with the totals but without filters, the room Quick play would join outlined. **Start a server** is a form: game type (Elimination / Sabotage), size (1v1 / 6v6 / 24v24), map (the picker's cards with a plan of the map, its region or bomb sites and who is playing there, filtered to maps the size and mode can host, or a shortcut beside it), visibility (Public: listed and filled by Quick Play, keeps its map and mode; Private: a 4-letter code shown in game) and bots (on / off), then START (`start_room`); the form is remembered, and a map the size or mode cannot host moves to the first one that can, with a note. **Join a server** lists every live room (map and round, mode, size, players, ping, Join; full rooms greyed with FULL; joinable first, then the most players, then the lowest ping; a lock when the map or mode is fixed; private rooms after the public ones, tagged Private, never with their code: their Code button asks for the four-letter code the host shared, and Quick play never joins them), with header totals and the server's region and ping, optional size and mode filters (All by default; the foot counts the rooms they hide), and a private room code box. Ping (`src/net/ping.ts`): `GET /v1/ping` on the SpacetimeDB host every 4 s while the lobby is visible, the handshake sample dropped, median of the last 5; green under 80 ms, amber under 160, red beyond; per server URI, so every room shows the one Maincloud database's ping today. Under all three: *Solo vs bots* (the form's mode, size and map; bot difficulty) and *Practice* (the form's map; no bots, free store). Options: language (English / 繁體中文), player chat (on / off: off hides other players' lines, the chat box and the chat buttons; a host platform can force it off with `setChatDisabled` in `src/game/settings.ts`), graphics, crosshair, scope view, reticle, sensitivity and aim sensitivity, field of view, volume, controls. The ? button opens the Controls tab where every key can be rebound (see [Controls](#controls)). In a match, Esc or P opens the same settings (Options and Controls tabs) with **Switch to SWAT / Militia** beside Leave match: only toward the side with fewer humans (bots fill both sides, so this evens out the people; a lone human may pick either side), applied in the buy freeze, the warmup or the result screen (the new side's base), and asked for mid-round it is held until the next round's buy freeze (pressing again cancels); the chat notes it (`change_team`, `canSwitchTeam` in `shared/match/sim.ts`). F toggles fullscreen. |
| Language | English and Traditional Chinese (Taiwan, 繁體中文): every lobby, settings, HUD, store, scoreboard and end-of-match string (`src/ui/i18n.ts`; SWAT 特警, Militia 民兵, Elimination 殲滅戰, Sabotage 爆破戰, maps by their Chinese names such as 西門町 and 台北101・信義; guns keep their real names). It follows the browser (zh-TW, zh-HK, zh-Hant read Chinese) until a choice is saved in Settings; `?lang=zh-TW` / `?lang=en` overrides it for the visit. Switching applies at once, in the lobby and in a match; kill-feed lines and toasts already on screen keep their language until they fade. Text the server sends (cash award reasons, room errors) stays English on the wire and is translated in the client. |
| Teams | **SWAT** (team 0, navy tactical kit) and **Militia** (team 1, desert and olive irregulars). In Sabotage Militia attacks and SWAT defends. No friendly fire. |
| Rounds | A new room's warmup first (8 s online, 3 s solo): everyone stands in their own base and may walk about, bots wait and nothing can be shot; then round 1. 4 s freeze at round start (buy, no moving), the round, a 5 s round-over pause; first team to **10 round wins** takes the match (**6** in public online rooms, so a newcomer finishes one in a sitting; private rooms and Solo keep 10), then 10 s on the result screen and a new match. Nobody respawns inside a round; everyone respawns at the next round start, except that a human who joins in a round's first 30 s (before the bomb is down) deploys in their base at once (`LATE_JOIN_SECONDS`). Dead players spectate their killer immediately (RMB cycles players); their chat is hidden from the living. |
| Elimination `[E]` | 120 s rounds. Kill the whole other team. If time runs out with both teams alive the round is a draw: it replays and nobody scores. When the last two players trade kills the team that killed last wins. |
| Sabotage `[S]` | 90 s rounds (120 s on single-site maps). Militia holds **E** for 5 s at site A or B to arm the bomb (no moving, shooting or aiming while arming; crouching is allowed). Arming sets the clock to 40 s and the other site goes inert; from then SWAT can only win by disarming (E for 5 s) — killing every Militia no longer ends the round — and the bomb going off wins it for Militia. Before arming: all SWAT dead → Militia win; all Militia dead or time out → SWAT win. No draws. |
| Room sizes | Duel 1v1 · Squad 6v6 · War 24v24 (big maps only: Meridian, bases padded to 24 slots). Bots fill every slot without a human (private rooms can turn them off). |
| Player | 100 health, no armor or regeneration within a round, fall damage, head/body/limb damage per weapon. Below 25 health the screen desaturates and a heartbeat plays that nearby players hear too. Stamina 100: sprinting drains 18/s (5 to start), a jump costs 20, it regenerates 18/s (24 crouched); at 30 or less you cannot sprint. Each weapon sets your move speed. |
| Economy | See the table below. **B** opens the store inside your own base during the first 20 s of a round (freeze time included); dead players can buy for their next spawn, and once a round is over (the 5 s pause before the next) everyone can buy anywhere. Weapons you own swap free during that window. Attachments can be bought anywhere, at any time. Weapons and attachments last the whole match and reset with a new one. Ammo crates on every map refill about half a magazine of the held weapon's reserve per use (E): the first use in a round costs $300, later ones are free. |
| Gunplay | Hitscan with BeGone's per-weapon numbers: fire rate, magazine and reserve, reload and equip times, hip/zoomed accuracy and recoil, zoom and move speed. RMB is "Accuracy": hold to zoom through the fitted optic (iron sights 3.5×). Auto-peek (ours, after Delta Force's 自動探頭): aiming with cover blocking the view within 1.3 m leans your head and shoulders 0.42 m out past its edge (toward the side whose view runs clear for 3 m); let go and you are back behind it. No key: the lean follows from your pose and the map (`shared/peek.ts`), so the server, bots and other players see and hit the leaning head where you see from. The knife hits for 33 anywhere at about 2 m. The M1014 fires 14 pellets. The M67 has a 2.1 s fuse and 22 m radius. The M18 smoke (ours, not BeGone's) pops 1.6 s after the throw into a still cloud 9 m across for 15 s: nobody sees through it, players or bots (enemy name tags included), but bullets pass. **Z** raises binoculars (10× zoom, no weapon). |
| Feel | First-person arms posed by IK onto CC0 gun models with optics that follow the fitted attachment (irons, reflex, holographic, ACOG, x4, x6), suppressor, laser and flashlight visuals; procedural sway, bob, kick, sprint carry, reloads and equips; knife-skin swings (藍白拖, 掃把, knife) keyed with a wind-up, a strike that speeds into the blow, and on a hit a short hit-stop and a rebound off the target, the view carried a little with the swing, and the struck soldier shoved, rocked back and its head snapped on springs that settle; muzzle flash, tracers (hidden when suppressed), impacts, explosions; hit markers, cash popups, damage arrows, kill feed, round banners; recorded CC0 gunshots per weapon (distance-muffled and panned, muffled when suppressed), knife, bomb, round and cash cues, footsteps and a 60-second menu theme sequenced from the game's own effects. |
| Characters | CC0 rigged soldiers in two team outfits, CC0 animation library retargeted by bone name: idle/walk/jog/sprint/crouch/jump/death blend by speed, strafing leg twist, aim pitch, two-bone arm IK onto the weapon, a knife stab, hit flinches. |
| Bots | Navigation grid per map (roofs, catwalks, stairs), A* paths, field of view and line of sight, reaction delays, aim error that settles, strafing, bursts, reloads and grenades. They shop at round start (the best primary they can afford, sometimes an optic and a grenade). In Sabotage Militia bots head for a site and arm it, SWAT bots spread over the sites, and everyone converges on an armed bomb. |
| HUD | Score bar with the round clock, round score and an avatar per soldier (alive or dead, teammates' health), health and stamina, cash, weapon with its attachments, ammo and reserve, grenades (M67, M18 smoke and 燃燒彈 molotov), bomb status and arming progress, minimap with sites, crates, smoke clouds and fires, a grey screen inside smoke, an orange glow at the screen's edges standing in fire, kill feed, chat (Enter all, T team; it also notes human players joining and leaving the room, never bots; the server masks swearing in chat lines and callsigns with ＊, English via `obscenity` (also spelled out letter by letter, "f u c k", "f.u.c.k") and Mandarin/Taiwanese from a list in `shared/profanity.ts`; challenge links and their preview pictures mask the challenger's callsign the same way), scoreboard (Tab), crosshair that widens with sustained fire, jumping and sprinting in four styles (classic, dot, circle, T), match result. |
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
| Burned (your 燃燒彈 fire burns an opponent; not in BeGone) | +$100 the first time each opponent burns in a round |
| Assist (damaged the victim in its last 3 s) · trade (both kill each other) | $200 · +$100 |
| Arm or disarm the bomb | $500 |
| Round won (each player) · survived · last man standing | $500 · $200 · $300 |
| Loss bonus (4th loss in a row onward) | $500 per loss |
| Loyalty (every 5 rounds on the same server) | $1,000 |
| Maximum | $16,000 |

### Weapons

| Slot (key) | Weapon | Price | Damage head / body / limb | Notes |
| --- | --- | --- | --- | --- |
| Primary (1) | MP5 | default | 30 / 18 / 12 | Automatic, 12 rounds/s, 32 + 96 |
| Primary (1) | M4A1 | $3,400 | 33 / 21 / 15 | Automatic, 9 rounds/s, 30 + 90 |
| Primary (1) | M1014 | $2,800 | 24 / 10 / 8 per pellet | Semi-auto shotgun, 14 pellets, 6 + 18 |
| Primary (1) | M110 | $4,000 | 90 / 40 / 30 | Semi-auto marksman rifle, 6 + 18 |
| Primary (1) | M249 | $3,800 | 43 / 33 / 21 | Automatic, 86 + 86, slowest movement |
| Secondary (2) | M9A1 | default | 29 / 22 / 15 | Semi-auto, 12 + 36 |
| Secondary (2) | MP7 | $1,800 | 18 / 12 / 8 | Automatic, 13 rounds/s, 20 + 60 |
| Melee (3) | Knife | free | 33 / 33 / 33 | Always carried; 2 swings/s; fastest movement |
| Tactical (4 / G) | M67 grenade | $1,000 | 70 (falloff) | One carried, not restocked; High Explosive mod $1,500 (+45 body damage, smaller radius) |
| Tactical (5 / X) | M18 smoke grenade | $300 | — | One carried; a 9 m cloud for 15 s that blocks sight, not bullets (not in BeGone) |
| Tactical (7 / U) | 燃燒彈 molotov | $400 | 32 per second | One carried; thrown like the M67, it breaks on the first floor it lands on (walls bounce it) and sets up to 6 m of floor alight for 7 s; walls stop the flames and they do not pour over ledges. Whoever stands in it burns (enemies and the thrower, not teammates); still in the air after 2.5 s it fizzles; smoke puts it out (a bottle breaking in a cloud fizzles, a smoke popped on a fire smothers it, and a smoke grenade landing in the flames pops there at once, as in Counter-Strike); bots buy and throw them and step out of fires (not in BeGone, after Counter-Strike's) |
| Tactical (6 / Y) | 珍奶 bubble tea | $400 | +50 health | One carried; drink when hurt: a 1.4 s sip (no shooting), then +50 health up to 100; the server applies it (`drinkBoba`, not in BeGone) |

**Skins (外觀; cosmetic only, `shared/skins.ts`)**: the lobby's 外觀 button (the T-shirt) picks how the
knife looks and which street character a Militia soldier is. Knife skins: **藍白拖 / Slipper** (the default:
the blue-and-white rubber slipper, swung as a flat slap with a cartoon slap sound), **金拖 / Gold slipper** (the
same slipper in polished gold, swung and heard the same; earned by inviting friends, see Inviting friends), **掃把 / Broom** (the
red-handled plastic broom with a neon-green head and splayed pink-and-green bristles, held two-handed and
brought down flat in an overhead swat, with a straw whoosh and THWUMP) and the classic **knife**. The knife
slot is called by your skin wherever it is named for you, and the kill feed names and marks the killer's.
Militia characters: Rotate (the default) or one of Farmer, Punk, Worker, Adventurer, Casual, Hoodie; SWAT
keep their one operator so the sides stay easy to tell apart. Looks, names and sounds only: the weapon id,
stats, strike, throw and pick-up are the knife's whatever the skin. The choice is saved per browser
(`src/game/skins.ts`; `?classic=1` shows the knife for one visit). Online the client sends it with the
`set_skin` reducer; the tick cleans it (`setSkin`) and keeps it in the soldier's gear JSON, and every client
draws it from the roster. Bots wear a skin picked from their id (`botSkin`), never the 金拖. The 金拖 is
locked until `GOLD_INVITES` (3) players have arrived through your links and entered a room: before that the 外觀
panel lets you try it on in the preview and offers 邀請朋友, the client wears the 藍白拖 (`wearable`), and the
`set_skin` reducer turns a locked 金拖 back into the 藍白拖 itself (it counts from `player_source`, see Inviting friends).

**飛拖 (thrown slipper; not in BeGone)**: with the knife (藍白拖, or whatever its skin) in hand, hold aim (right mouse; the aim
button on phones) to wind it up for up to 0.8 s, and let go to throw it (`SLIPPER` in `shared/weapons.ts`:
10 m/s at no wind-up, 30 m/s at full). In flight it hurts the first enemy it strikes: 30 thrown without a
wind-up, rising with it to 100, and only a full wind-up kills outright (`slipperDamage`); a kill with it counts
as a knife kill. The first wall or floor it touches makes it harmless. Everyone carries exactly
one each round: once thrown you have no slipper (no slap, slot 3 is skipped) until you walk over one lying
on the ground (yours or anyone's, within 1.3 m; a lying slipper shows a pulsing ring). The server simulates
the flight and the strike (`slipperStrike`, `pickUpSlippers` in `shared/match/combat.ts`); the client only
sends the throw and its wind-up (`slipper` reducer). Bots do not throw it.

**珍奶 (bubble tea)** is a real item: bought in the store's tactical tab, drunk with 6 / Y (or the touch
button beside the knife) when hurt. The cup comes up to the mouth in first person with a slurp that
players nearby hear; the server heals +50 when the sip ends.

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

Thirteen maps are offered today. Crane, Tower, Courtyard, Cinder Basin, Frostline Reach and Verdant
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

**Taipei** is Ximending (西門町), a stylised pedestrian district under neon, laid out by this project
(`shared/maps/ximending*.ts`; the plan is in `ximending-plan.ts`). It is drawn in the spirit of the real
district and its landmarks, not surveyed, and it is not taken from any other game: a composite of three
east–west lanes (north, middle, south) crossed by three north–south streets (West St, Hanzhong St 漢中街,
East St), 162 × 132 m (Squad rooms), ringed by a road for cars. SWAT deploys at the west end, in the
plaza by the MRT exit (a glass station pavilion, a bus shelter, hedges); Militia at the east end, in a
construction yard (hoarding, a site office on stacked containers, a crane). Each base opens three ways
(the lane between the screens, and two alleys, north and south), and a pair of police or site barriers
across its mouth hides it from the lanes. The bomb sites are A, Cinema Street (電影街): the Starlight
Cinema's front on the north lane, under its marquee balcony, with a stair up at each end and the lobby
behind (doors on the lane, on Hanzhong St and to the north sidewalk); and B, the Red House square
(西門紅樓廣場) on the south lane: the octagonal brick hall with its lantern, the cross-shaped wing,
café tables and trees on a brick square. The bases are about 140 m apart on foot and SWAT reaches
each site about two seconds (sprinting) before Militia (`shared/maps/ximending.test.ts` checks it).
Between them:
- the covered night market (西門夜市) along the middle lane: a tarp roof over rows of stalls, with
  alleys north and south of it that join the lanes;
- the game arcade (電玩城) across the middle lane: a hall of cabinets with doors on all four sides, a
  roof with the helicopter's pad (one ladder from Hanzhong St, one from East St), a skybridge (a glazed
  corridor) over the middle lane to the hotel's roof, and a ladder down the hotel's south face;
- the mall passage (西門商場) through the north-west block, the shop-front arcades (騎樓) along the
  lanes, and neon fascias, blade signs, gantries and string lanterns over everything.
Every long street is broken up by chicanes (two walls of street clutter, a van and a booth, a container,
a poster hoarding, a bus shelter, a billboard, standing out from opposite sides, one after the other),
so no eye-level line between two places a soldier can stand runs longer than 60 m except along the ring
road's drive lanes, the rooftops are rimmed by windowed walls (they look across a street, never along
it) and covered galleries roof the lane ends (out of a jump from anything near them, so nobody perches on
one to look down a lane). Everything sits on the bots' 2.5 m navigation grid
(bots walk every alley, stair, hall, roof, bridge and ladder). The city past the map, with Taipei 101
on the horizon, is a procedural skyline (client only, `src/render/cityscape.ts`); the shop names are
generic (a noodle shop, a game hall), not brands.

**Taipei 101 · Xinyi** (big map, 24v24) is a stylised Xinyi (信義) business district around Taipei 101,
laid out by this project in the spirit of the real one (`shared/maps/xinyi*.ts`, the plan in
`xinyi-plan.ts`; not a survey, and not taken from any other game). A row of department stores and
towers on the north, Xinyi Rd under it (twenty metres of asphalt with a planted median), the tower
block in the middle, Heping Rd, and an old village on the south; Keelung Rd closes the west and
Songren Rd the east, with the foot of Elephant Mountain (象山) rising past it. The tower is scenery
(`shared/maps/tower101.ts`, our own outline of it from public facts: only its base collides); the podium
mall beside it is opened as the centre of the fight: **A** is its atrium, a food court sunk to B1 under
a ground-floor ring and a gallery at F2, with a bridge across the void, stairs between all three floors,
doors north, south and east, and a B1 passage out to **D**, the sunken garden (a pool, a pavilion, stairs
up at both ends). **B** is the west plaza by the tower's foot, round a sculpture and an MRT exit
pavilion; **C** is the skywalk, a glazed corridor eight metres up over Xinyi Rd (a stair down to the
plaza, a ladder up from the sidewalk by SWAT's forecourt); **E** is the village (low brick houses with tin
roofs, a middle row to fight through with a ladder to its roof lookout). SWAT deploys in a forecourt on
the north sidewalk behind a police cordon (two gates, staggered baffles inside); Militia in one on the
south behind site hoarding. Cars wait on both boulevards, scooters at the bases, and the helicopter on
a pad at Xinyi Rd's east end. About 272 × 292 m. SWAT reaches each site about 1.5–2 s ahead of
Militia (`shared/maps/xinyi.test.ts` checks the reachability of every site, floor, bridge, deck, roof,
crate and ladder, the leads, and a 24v24 deployment). The skyline past the map is procedural (client
only, `src/render/cityscape.ts`); the shop names are generic.

**Taipei 101 · 88F** (台北101・高樓辦公層; 1v1 and 6v6, Elimination and Sabotage) moves the fight
indoors, onto an office floor near the top of the same tower (`shared/maps/taipei101.ts`). The floor
plate is the tower's notched square, 50 m across at the glass, set at the height (about 385 m) where
the tower's top module (`shared/maps/tower101.ts`, our own outline of the tower from public facts)
reaches that width, so the modules below the glass come from the same outline. A 3 × 3 plan round a stone core: the Chairman's and CEO's corner suites either side of
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
The city below — a seeded, procedural fill of blocks over the basin's flat ground, with hills and a
river — is the client-only `taipei101` dressing set (`src/render/cityscape.ts`),
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

**Sanchong** (三重, 1v1 and 6v6) is close-quarters city fighting in the old blocks of Sanchong, New
Taipei, across the Tamsui River from Taipei (`shared/maps/sanchong*.ts`, hand-built; a composite, not a
survey). Four- and five-storey walk-ups (公寓) with iron window cages (鐵窗), AC units, tin shacks on
their roofs (頂樓加蓋) and water tanks, shopfronts behind rolling shutters, vertical shop signs, overhead
wires and rows of parked scooters everywhere. Three lanes run east–west between the bases:
- **North: the main street** (重新路-like) under its arcades (騎樓, broken here and there by shops built
  out into them), with a delivery van, a betel-nut kiosk (檳榔攤) and a pilgrims' tour bus (進香團) parked
  across it. It ends at the **temple square** (廟口): the temple (神農宮, after 先嗇宮) with its portico,
  stone lions and swallowtail ridge, the incense burner on its axis, the gold furnace, offering tables,
  lantern strings and the opera stage (戲台, climbable) facing it. The temple is walk-through from the
  square to the east main street; an arcade passes behind it.
- **Above and behind it: the Taipei Bridge approach** (台北橋引道): a raised deck at 6.5 m reached by the
  scooter ramp (機車引道, the 機車瀑布) from the north-west corner and a stair from the east, high ground
  over the square but exposed, broken by a stalled truck and the road works' site office and shut by a
  hoarding before the levee. Below it runs the **under-bridge lane** (橋下) with its piers, a kiosk, a
  scooter repair cage and a recycling pile.
- **Middle: the covered market** (三重市場): two aisles of stalls round a centre row of island stalls,
  one door at each end (the west door into the north aisle, the east door into the south aisle) and a
  stall across each aisle, so a run through the hall weaves from aisle to aisle; open-air market street
  at both ends.
- **South: the back alleys** (巷弄): three-to-four-metre lanes that zigzag between old houses, a pocket
  square with the earth-god shrine (福德祠), its paper furnace and a banyan, and a roof terrace up a ladder.

Lanes centred on the bots' lattice link them north–south (two dog-legs among them). **A** is the temple
square; **B** is the **ironworks yard** (永興鐵工廠) behind the market: steel plate stacks, a container,
oil drums, a gas-bottle cage and a forklift under a gantry crane, entered from the market (north gate),
the alley (south gate), the print shop's passage (east) and through the workshop (west), whose roof is
up a ladder. Landmarks C–E are the bridge deck, the market's crossing and the shrine pocket. SWAT
deploys on the levee road (環河北路) at the foot of the river's flood wall (淡水河堤防, the east edge; a
pump station juts from it), Militia in the night-market car park (west) by a temple-fair neon truck
(電子花車); stall sheds, containers and a pump truck offset the streets' gaps so no view runs into a base.
Two drivable scooters wait at each base. Late-afternoon light (`sanchong` theme), Taipei's towers
across the river. About 152 × 116 m; the bases are about 155 m apart on foot. `shared/maps/sanchong.test.ts`
checks that no eye-level line between two places a soldier can stand exceeds 60 m (no exemptions), that
no spawn slot sees the other base, that SWAT reaches each site 1.5–2.5 s ahead of Militia (2.3 s at
both), that bots reach every lane, deck and roof from both bases, that every standing spot has
chest-high cover within 8 m, that Militia bots arm both sites, and the bases' slots and crates.

Every map has ammo crates (one more stands in each base) and open team bases. Sabotage lists only the
maps with bomb sites.

### Vehicles

Maps can park drivable vehicles (`MapDef.vehicles`, placed with the builder's `vehicle(...)`):

| Map | Vehicles |
| --- | --- |
| **Taipei** (`ximending.ts`) | Six cars on the ring road: the inner lane is the lap, the outer lane holds the parked ones, two cars behind each base and one on the north and south sides; scooters on the ring's outer lanes, at both bases' edges and in West and East Streets; a helicopter on a painted pad on the arcade's roof (up a ladder) |
| **Meridian District** | On each base boulevard: two cars, two scooters and a helicopter |
| **Taipei 101 · Xinyi** (`xinyi.ts`) | Two cars on Xinyi Rd by SWAT's forecourt and two on Heping Rd by Militia's, one on Songren Rd and one on Keelung Rd; scooters at both forecourts and on the west plaza; a helicopter on a painted pad at Xinyi Rd's east end |

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
A rider always sits square on the bike, torso included (for everyone watching too): looking round turns only the head (at most about 25°), and the arms bring the weapon round.

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


### Sharing a match and 發起單挑

The end screen has **分享戰績 / Share**: a 1080×1920 card (`src/ui/sharecard.ts`) over a frame of the match with
the result, one brag line picked from the match (`src/game/matchstats.ts`: beating a challenger, slipper kills, a
multi-kill round, kills on the map, headshots…), the numbers, the callsign and **發起單挑 →** with a QR code and link.
Phones share the picture and link through the share sheet (IG Stories, LINE, Threads); a browser with Web Share
but no file sharing sends just the text and link; elsewhere the link is copied and the picture can be saved
(`src/ui/sharechoice.ts` picks the buttons and the fallbacks). Solo cards say "vs bots". **約朋友單挑 / Challenge a
friend** is the end screen's wide first button: online it opens a private 1v1 room on the match's map, without bots,
and offers that room's link (a big Send challenge button first) from inside it; with no online play it shares a link
that plays against the challenger's bot double. In a 1v1 against a friend the end screen counts down to a rematch (the
room starts the next match by itself). Every link we hand out carries `utm_source` (`share`: a card, `challenge`: a
link without a room, `duel`: a link to our room) and `utm_medium` (`share_card`). A friend who opens a challenge link sees 「<name> 向你下戰帖！」 in the lobby and
is one tap from the room; if it is gone, full or empty they play a Solo 1v1 against a bot carrying the challenger's
name, and either way the end screen says who won and offers their own card.

The share dialog (`src/ui/sharepanel.ts`) prefills the message (the brag line, the map and the kills; editable) and
sends it with the link through **LINE** and **Threads** (their own share pages, `src/ui/sendto.ts`, which work in
desktop and in-app browsers too), the phone's share sheet with the picture (IG Stories), Save image or Copy link; a
card without a room also offers **改開 1v1 房間發起單挑** (the 約朋友單挑 flow). Challenge links are `/c?ch=…&map=…&beat=…`
(older `/?c=1&…` links still open).

### Inviting friends (邀請朋友) and link previews

**邀請朋友 / Invite friends** sits under Quick Play (online only): one tap opens a private 6v6 with bots on the
form's map (the first 6v6 map if it doesn't fit) and shows the invite dialog over it (`src/ui/invitepanel.ts`): the
room's code, who is in the room (live), LINE, Threads, Copy link, the share sheet where there is one, and a QR code
for a friend sitting next to you. 開始對戰 closes it and plays on; bots hold the seats and a friend who joins takes
one. The link is `/r/<code>?ref=<share code>`: whoever opens it sees 「朋友邀你一起打！」 in the lobby and joins the
room in one tap (a closed room says so). Arrivals through `/r/…` count as `utm_source=invite`, `utm_medium=link`.

The button's corner counts toward the **金拖**: the server's `my_invites` view gives each player how many players
arrived through their share code (`player_source.ref_by`) and how many of them entered a room; three who played
unlock it. The count arrives with an online match and is kept in the browser for Solo.

**Link previews.** A chat app's link-preview crawler (LINE, Threads and the other Meta apps, Discord, X, Telegram,
Slack, iMessage…) asking for a `/c` or `/r/…` link gets a small page from `api/preview.ts` (vercel.json rewrites
those two paths there only for known preview-crawler user agents) whose Open Graph tags read 「<name> 向你發起單挑！」 with the map and kills, or
「朋友邀你一起打《角頭械鬥》」 with the room code, and a 1200×630 picture drawn by `api/og.ts` (@vercel/og) over the
map's art. People get the game as usual.

### New players, progress and staying in the match

- **Rookies.** A player with fewer than 10 rounds played (online: the server's career stats; Solo: this
  browser's progress) is a rookie: bots react later to them (0.6 s on their first round, 0.06 s less for
  every round played, counting rounds in the current match) and aim looser at them (`ROOKIE_EASE` and
  `rookieEase` in `shared/match/bots.ts`), so a first fight is winnable. Online bots play at skill 0.3
  (`ONLINE_CONFIG`; Solo 0.45, Practice 0.4).
- **Touch aim assist** (Settings → Controls → Aim assist, on by default; touch screens only): the crosshair
  slows over an enemy you can see and, while you fire, drifts onto them at most 20°/s; the cones narrow
  with the scope's zoom (`src/game/aimassist.ts`).
- **Level and daily goal** (`src/game/progress.ts`, kept only in the browser): XP for rounds, wins, kills and
  headshots, levels at 100, 160, 220… XP, and one goal a day in rotation (win 3 rounds, get 8 kills, play 6
  rounds, land 3 headshots; +100–150 XP). The lobby shows both under the title; a finished goal or a new
  level is announced in the match.
- **Upright phones** (in-app browsers such as Threads and Instagram never turn to landscape, nor does an
  iPhone with rotation lock): the match turns the page a quarter and the player turns the phone
  (`src/ui/viewport.ts`); in-app browsers get a lobby note, and on Android an Open in Chrome link.
- **Dropped connections** reconnect and rejoin the same room (Reconnecting… over the match); a lost
  graphics context waits for the browser to hand it back before offering a reload; on a computer, a
  refused mouse capture (just after Esc) shows Click to resume.

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
| 1 · 2 · 3 | Primary · secondary · knife |
| 4 or G | M67 grenade |
| 5 or X | M18 smoke grenade |
| 6 or Y | Drink the 珍奶 (heals +50) |
| 7 or U | 燃燒彈 molotov |
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
| Esc or P · M | Menu: release the mouse (pauses solo; Resume or Esc / P to go back) · from the menu, back to the lobby (after "Leave the match?"; at once on the end screen) |

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
its own. A second trigger, **Hip fire** (left thumb, above the stick), always shoots from the hip and never
raises the sights, so one button aims on a long press and the other never does. Aim is a toggle; Crouch is held, as the key is (held while sprinting it slides; letting go stands up). The HUD keeps clear of notches and the home bar, but
the crosshair, scope and markers stay on the screen's true centre where shots go. Buttons press the same actions as keys (`src/game/touchlayout.ts` →
`Input.touchHeld` / `touchPress`), and only those that matter are shown: Use appears near a vehicle,
crate or bomb site (hold it to arm or defuse), vehicle buttons replace the on-foot ones while seated, a
scooter rider keeps fire and the one-handed guns, and the dead get Next. Quick chat opens the keyboard
on Type. **Edit touch layout** (Settings → Controls) drags, pinches or slides to resize, hides, sets
opacity, assigns two custom slots any action, swaps to left-handed and resets; it is saved in the browser
(versioned, only the changes). Phones, and computers on Intel integrated graphics or a software renderer, start on Low graphics (until the player picks a preset); phones ask for landscape during a
match, request fullscreen on Android, and keep page scroll, zoom and long-press menus off in play.

The game installs as a web app: `public/manifest.webmanifest` (fullscreen, landscape, icons from
`bun tools/make-icons.ts`), iOS home-screen meta tags, and a service worker (`src/pwa/sw.ts`, built to
`/sw.js` with this build's file list) that fetches the page network-first, serves this build's files from
a cache versioned by the build and the models, textures, sounds and fonts from one cache kept file by
file, and never touches SpacetimeDB, its ping, PostHog or `/admin`. Every asset URL carries its content
hash (`?v=`, `src/assetUrl.ts` and `vite.config.ts`), so Vercel serves it `immutable` (browsers without
the worker, such as in-app browsers on iOS, keep it too) and a release re-downloads only files that
changed. The lobby loads the models and the surface textures every map builds with; a map's own ground
textures (sand, snow, rock…) load as its match starts. Phone visitors see an install hint in the
lobby (Install where the browser offers it, Share → Add to Home Screen on iOS) until they dismiss it.
