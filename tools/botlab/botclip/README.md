# Clips of bot play, made frame by frame in an orb

The orb has no GPU, so a frame takes about 1.9 s to draw. These tools step the Solo game one tick at a time
(`?capture`, `window.__lb.step`) and take one picture for each tick, so the clip has the exact motion of 30 ticks each second.

Needs: the dev server on port 31417 (`amp orb service start game --command 'bun run dev -- --port $PORT' --port 31417`), `agent-browser`, `ffmpeg`.

- `setup.js`: removes the human and makes the 12 bots again from a seed. The match then repeats exactly.
- `clock.js`: puts the HUD on the game clock (timers, CSS animations, `performance.now()`). Without it a kill feed line shows for 4 frames and the round banner is absent.
- `director-all.js`: the bot whose eyes the clip uses, by tick; hides `.vitals`, `.arms`, `.fps`; records what the HUD shows (`window.__clipHud`).
- `quality.js`: half resolution, hard 1024 shadows, no muzzle lights. Do not use the Medium preset (6.5 s for each frame).
- `dry.js`: steps N ticks with no picture (1,500 ticks take about 4 s).
- `prep.sh <session> <seed> <startTick> <directorFile>`: opens the page and does the four steps above.
- `render.sh <session> <outdir> <frames> 50`: writes `f%05d.jpg`. Frame `k` shows tick `start + 1 + k`.
- `clips.sh <session> <seed> <outroot> <start1> <frames1> [<start2> <frames2> ...]`: all of it, in the background (about 38 min for 1,240 frames).
- `check.py <hud.json> <kills.json> <start> <frames> ...`: compares the clips with the match log.

The two clips of 2026-11-13: `./clips.sh botclip 20261113 /tmp/botclip2 1330 350 6990 890`, then

```sh
ffmpeg -framerate 30 -i /tmp/botclip2/c1/f%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart round2-orrin-three-kills.mp4
ffmpeg -framerate 30 -i /tmp/botclip2/c2/f%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart round6-bought-weapons.mp4
```

Names: SWAT 13 Atlas, 14 Orrin, 15 Dagger, 16 Kestrel, 17 Sable, 18 Juno. Militia 19 Vex, 20 Shrike, 21 Wren, 22 Marrow, 23 Halcyon, 24 Quill.

The two clips of 2026-11-14 (all 12 bots with the learned aim; other seed, so other names: `names-20261114-learned.json`):
`EXTRA='&learned=1' DIRECTOR=$PWD/director-learned.js ./clips.sh learnclip 20261114 /tmp/botclip3 2040 270 3590 640` (about 25 min), then the same
`ffmpeg` lines to `learned-aim-round2-pike-lumen.mp4` and `learned-aim-round3-dagger-m4a1.mp4`. Check:
`CLIP_NAMES=names-20261114-learned.json python3 check.py hud.json kills.json 2040 270 3590 640`.
