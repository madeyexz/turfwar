# Trailer

Everything that makes the Lawbreaker // Frontline trailer, all of it local: the shot list, the
capture tools that film the real game frame by frame, an original procedurally composed score, the
cards, and the edit that cuts them together.

| Output (not committed) | |
| --- | --- |
| `out/lawbreaker-trailer.mp4` | 106 s, 1920×1080, 30 fps, H.264 + stereo AAC, −14 LUFS |
| `out/lawbreaker-trailer-30s.mp4` | the 30-second cut-down |

## Regenerate

```sh
bun install --frozen-lockfile && bun install --cwd spacetimedb --frozen-lockfile
bun trailer/scripts/make.ts            # everything; `--recapture` re-films every shot, `--only-build` re-cuts only
```

`make.ts` needs Google Chrome, ffmpeg (8.x tested) and the SpacetimeDB CLI. It starts and stops its own
services, all local and disposable: an in-memory SpacetimeDB on `127.0.0.1:3251` with the module
published as `lbtrailer`, headless clients from `scripts/loadtest.ts` Quick-Playing into 1v1, 6v6 and
24v24 rooms (so the lobby's public room list has something in it), and the Vite dev server on
`127.0.0.1:5201` pointed at that server. Nothing touches Maincloud. A full run takes about 20 minutes
on an M3 Pro, most of it the captures.

The steps can also run alone (with the dev server up on 5201):

| Script | Does |
| --- | --- |
| `scripts/capture.ts [--only a,b] [--preview] [--force]` | Films the shots in `shots.ts` into `captures/<shot>.mp4` and the sounds the game played into `captures/<shot>.sounds.json`. `--preview` writes a contact sheet per shot to `captures/preview/` instead (seconds per shot). |
| `scripts/cards.ts` | Renders the title, captions, tags and end card (`web/card.ts`) into PNG frames with alpha. |
| `scripts/audio.ts` | Renders the score for each cut (`music/score.ts`, kept as `music/<cut>.flac`) and the game's sound for each cut, replayed from the capture logs. |
| `scripts/build.ts [--sound-only]` | Cuts `edit.ts` into `out/` (`--sound-only` re-masters the sound onto the finished picture). |
| `scripts/analyze.ts` | Loudness curves, impacts vs cuts, spectrograms and waveforms. |
| `scripts/probe.ts`, `scout.ts`, `sheet.ts` | Scouting stills, camera tests and contact sheets of any clip. |

## How the capture works

- `scripts/cdp.ts` launches its own headless Chrome (GPU, Metal) on a private profile and talks the
  DevTools protocol directly; no Playwright.
- `scripts/vclock.ts` is injected before the page's scripts: `performance.now`, `Date`, timers,
  `requestAnimationFrame`, CSS animations and transitions and `Math.random` (seeded) all run on a
  virtual clock that only the capture advances, 1/30 s per frame. A frame can take as long as it
  needs to render and screenshot; the footage is still perfectly smooth and repeatable.
- The game runs with `?capture&trailer` (dev server only). `?capture` (existing) stops the game's own
  loop; `?trailer` loads `src/game/trailer.ts`, a dev-only director on `window.__trailer`: scripted
  keys, aim and trigger (`fight`, `input`, `press`), a vehicle autopilot (`drive`), cinematic cameras
  (`camera`: paths, orbits, follow and track) placed through one hook after the game's own camera,
  HUD modes, slow motion, and staging in the local Solo match (`teleport`, `stage`, `place`, `god`,
  `pacify`). It changes no rules; production builds never include it.
- Frames are screenshotted at 1.5× device scale and downscaled with Lanczos (supersampled edges),
  at the high graphics preset.
- Every sound call the game makes is logged with its time. `scripts/audio.ts` replays the log for
  each cut on an `OfflineAudioContext` with the game's own `Audio` class (the same recordings, mix
  chain, distance and panning), so the gunfire, reloads, engines and explosions are the game's
  own and land on their frames.

## Music

`music/score.ts` composes an original cinematic score by rule and renders it offline in the browser
(no sampled music): D minor at 120 BPM, so a beat is exactly 15 frames and every section starts on a
cut. `edit.ts` gives each cut its sections in beats and the score reads the cut times from the edit,
so another cut with the same timing (the planned zh-TW version) reuses it as is.

The orchestra is synthesized: spiccato string ostinatos and legato strings (detuned saw ensembles),
low brass stabs and horn lines, a formant choir, taiko and orchestral drums, sub booms, braams,
reverse-cymbal swells, risers and Shepard tones, through two convolution halls (3.4 s and a 5.5 s
impact tail) with wide stereo. The beds duck under every impact (sidechain) and the master gate cuts
everything, tails included, for the silent beats.

The game's own sounds are part of the score: charging handles, bolts, racks and slides
(`public/assets/sfx/foley-*`) hit on the picture's cuts; shell casings play the hi-hats and fills; big
M110 and M1014 shots with long tails sit on the impacts and M4A1 shots on the backbeat; an M249 burst
is the drum fill into the drop; a dry-fire click is alone in the last silent beat; and from
`src/audio.ts`, the helicopter's rotor spins up as the swell into the vehicles, the bomb's beep is the
Sabotage pulse and the M67's blast is the final sub-drop.

| Full cut | Section | Score |
| --- | --- | --- |
| 0–8 s | open | Ominous: low string drone, distant taiko, a reverse cymbal into the title |
| 8–12 s | title | Impact: braam, boom, sub, M110 shot with a long tail, taiko ensemble |
| 12–20 s | store | The build starts: eighth-note strings (Dm–B♭–Gm–A), taiko on 1 and 3, shell ticks |
| 20–36 s | guns | Sixteenth-note ostinato, taiko groove, brass stabs (Dm–B♭–F–C), gun handling on every cut |
| 36–50 s | tension | Sabotage and Elimination: half time, the bomb's beep quickening, a Shepard tone climbing |
| 50–58 s | fill | Mechanics: rising Shepard and snare roll, the rotor swell, the M249 burst into the drop |
| 58–73 s | drop | Full power on the vehicles: braam, brass stabs, driving strings, backbeat gunshots, choir |
| 73–74 s | silence | Everything stops; a casing falls |
| 74–90 s | climax | The heroic theme in brass and strings over the maps (B♭–C–Dm–F–Gm–B♭–C–D), choir |
| 90–96 s | rise | Lobby: risers, Shepard and snare roll; the last beat silent but for a dry-fire click |
| 96–106 s | end | Final braam, grenade sub-drop, a held D minor chord with choir, long tail |

The 30-second cut has its own condensed arrangement: open, title hit at 2 s, the guns build (M249
fill), the drop at 10 s, the climax at 16 s, the rise with its dry-fire stop, the end braam at 24 s.
The final mix (`scripts/build.ts`) puts the in-shot game sound about 5 LU under the score, ducks it
under the score's peaks, drops it under the cards and in the silent beats, and masters to −14 LUFS
under −1 dBTP. `scripts/analyze.ts` prints the loudness curve and the impacts against the cuts and
draws spectrograms (`build/analysis/`). `scripts/audio.ts` also writes each rendered score to `music/<cut>.flac` (regenerated, not committed).

## Shots (`shots.ts`) and the cut (`edit.ts`)

Shots are staged in Solo matches and the lobby: the cold open over Ximending with Taipei 101, the
gateway on Hanzhong St, the store (M4A1 and a holographic sight), gunplay with the MP5, M4A1 (holo),
M110 (x6 through the lens), M1014 and M249, Sabotage arming and disarming, a slowed 3v3 on Crane,
the knife, an M67, binoculars on Taipei 101, a slide, the Tower ladder, the helicopter off the
7-TWELVE roof and over the district, a drift on the ring road, a scooter rider shooting one-handed,
the maps (Taipei 101 · Xinyi and its atrium, the night market and Cinema Street, Crane, Tower,
Warehouse, Meridian at 24v24) and the online lobby. `edit.ts` lists the segments, cards and score
sections of both cuts, in frames.

## Credits and licences

- Game footage, the score, cards and tools: this project's own (same terms as the repository).
- Sound effects in the score and the mix: the game's CC0 1.0 recordings (`public/assets/sfx`, see
  its `LICENSE.txt`: *The Free Firearm Sound Library* and the OpenGameArt foley packs).
- Typeface: Rajdhani by Indian Type Foundry, SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
- Taipei and Taipei 101 · Xinyi are from *臺北狂飆 / TAIPEI RUSH*, used with its author's permission;
  models and textures are CC0 (Quaternius, Poly Haven), as listed in the main README.
- No copyrighted music.

## Known limits

- The lobby's rooms are headless load-test clients on a local server, not real players.
- Fights are staged: enemies are placed, the filming soldier is kept alive (as in `?bench`), and in
  a few shots enemies hold fire. Everything on screen is the real game and its rules.
- The meshes of Taipei 101 (Xinyi) are scenery at night; Ximending is at dusk.
