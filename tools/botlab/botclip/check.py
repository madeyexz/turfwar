#!/usr/bin/env python3
"""check.py <hud.json> <kills.json> <start> <frames> [<start> <frames> ...]: does each clip show what the match log says?

hud.json is window.__clipHud ([tick, [kill feed lines], banner opacity, banner text] for each frame) and kills.json is
[tick, killer, victim, weapon] for each kill. A kill feed line stays 7 s (210 frames) and the feed holds 6 lines.
"""
import json, os, sys

NAMES = {int(k): v for k, v in json.load(open(os.environ['CLIP_NAMES'])).items()} if os.environ.get('CLIP_NAMES') else {13: 'Atlas', 14: 'Orrin', 15: 'Dagger', 16: 'Kestrel', 17: 'Sable', 18: 'Juno',
         19: 'Vex', 20: 'Shrike', 21: 'Wren', 22: 'Marrow', 23: 'Halcyon', 24: 'Quill'}
hud = {row[0]: row for row in json.load(open(sys.argv[1]))}
kills = json.load(open(sys.argv[2]))
clips = [(int(sys.argv[i]), int(sys.argv[i + 1])) for i in range(3, len(sys.argv), 2)]
bad = 0
for k, (start, frames) in enumerate(clips, 1):
    first, last = start + 1, start + frames
    missing = [t for t in range(first, last + 1) if t not in hud]
    print(f'clip {k}: ticks {first}-{last}, {frames} frames, {len(missing)} without a HUD row')
    bad += len(missing)
    for tick, killer, victim, weapon in kills:
        if not first <= tick <= last: continue
        want = NAMES[killer].lower(), NAMES[victim].lower()
        shown = [t for t in range(tick, last + 1) if t in hud and any(l.lower().startswith(want[0]) and l.lower().endswith(want[1]) for l in hud[t][1])]
        expect = min(210, last - tick + 1)
        gone = shown[-1] + 1 if shown else tick
        crowded = gone in hud and len(hud[gone][1]) >= 6
        ok = len(shown) >= expect - 1 or crowded
        bad += 0 if ok else 1
        print(f'  {tick} (frame {tick - first:3d}, {(tick - first) / 30:5.2f} s) {NAMES[killer]:8s} {weapon:7s} {NAMES[victim]:8s} line shown {len(shown):3d} of {expect:3d} frames{" (pushed out by newer lines)" if crowded and len(shown) < expect - 1 else ""}{"" if ok else "  <-- SHORT"}')
    on = [t for t in range(first, last + 1) if t in hud and hud[t][2] > 0.05]
    runs, run = [], []
    for t in on:
        if run and t != run[-1] + 1: runs.append(run); run = []
        run.append(t)
    if run: runs.append(run)
    for run in runs: print(f'  banner "{hud[run[0]][3]}" visible ticks {run[0]}-{run[-1]} ({len(run)} frames)')
    if not runs: print('  no banner in this clip')
print('OK' if not bad else f'{bad} PROBLEMS')
