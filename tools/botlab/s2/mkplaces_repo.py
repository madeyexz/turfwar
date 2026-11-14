"""Lab: write shared/match/places.ts from the human dwell (visits_human.py; Elimination 6v6, the time after the first 10 s of a round).
Per map and base side: the 6 m cells with the most time until they hold 80% of it, 96 at most, as x, y, z (m, to 0.5) and a weight;
the weights of a side sum to 10,000. Totals only.   Usage: python mkplaces_repo.py out.ts && bun placefix.ts out.ts
(placefix.ts leaves out the cells that a bot cannot walk to and makes the weights sum to 10,000 again.)"""
import json, sys
H = json.load(open('/tmp/rec/out/visits_elim.json'))
COVER, MOST, SUM = 0.8, 96, 10000
half = lambda v: ('%g' % (round(v * 2) / 2)).replace('-0', '0') if abs(round(v * 2) / 2) < 0.25 else '%g' % (round(v * 2) / 2)
lines = []; n_cells = 0; hours = []; players = []
for mp, sides in sorted(H.items()):
    rows = []
    for t in ('0', '1'):
        c = sides[t]; cells = []; cum = 0.0
        for a in c['cells']:
            if len(cells) >= MOST or cum >= COVER: break
            cells.append(a); cum += a[3]
        w = [max(1, round(a[3] / cum * SUM)) for a in cells]
        w[0] += SUM - sum(w)
        assert sum(w) == SUM and min(w) >= 1
        rows.append('[' + ','.join('%s,%s,%s,%d' % (half(a[0]), half(a[1]), half(a[2]), k) for a, k in zip(cells, w)) + ']')
        n_cells += len(cells); hours.append(c['hours']); players.append(c['players'])
    lines.append('  %s: [\n    %s,\n    %s,\n  ],' % (mp, rows[0], rows[1]))
head = '''/**
 * Where recorded players stay in 6v6 Elimination, after the first 10 s of a round: per map and base side (0, 1), the 6 m cells with
 * the most time, until they hold 80%% of it (96 cells at most). Cells that a bot cannot walk to are left out: decks and roofs that
 * the nav grid does not cover. Each cell is four numbers: x, y, z (m, the mean position of the players in the cell) and a weight;
 * the weights of a side sum to PLACE_WEIGHTS. Bots take their roam goals from this table (bots.ts, chooseGoal); a map that is not
 * here uses its landmarks. Totals of the recordings from 2026-10-15 to 2026-11-10 (%.1f to %.1f h and %d to %d players per side);
 * there is no data of one player here. docs/DEVELOPMENT.md, "Bot bench", says what to do when a map changes.
 */
export const PLACE_WEIGHTS = 10000;
export const PLACES: Record<string, readonly (readonly number[])[]> = {
''' % (min(hours), max(hours), min(players), max(players))
open(sys.argv[1], 'w').write(head + '\n'.join(lines) + '\n};\n')
print('cells', n_cells, 'sides', len(hours))
