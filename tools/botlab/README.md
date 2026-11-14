# Bot lab: the research scripts behind the bots' habits and the learned aim

These are the scripts of the research of 2026-11-10 to 2026-11-14 on what the recorded play can teach the bots
(docs/RECORDING.md, "Use in the bots"; docs/DEVELOPMENT.md, "Bot bench"). They are kept as they ran. They are not
runtime code, `tsc` and Vitest do not read them, and many are one-off measurements.

The directory holds scripts only. It holds no recording, no extracted row, no trained weight and no key. The
scripts print and write totals of many players; a player is an opaque number in the extracted rows.

## What you need

- An Amp orb of this project, or a machine with the same paths. The scripts have fixed paths: the repository at
  `/home/user/workspace/repo`, the lab at `/tmp/botlab`, the data and the results under `/tmp/rec`.
- The read-only R2 keys `R2_REC_READ_ACCESS_KEY_ID` and `R2_REC_READ_SECRET_ACCESS_KEY`, and `CLOUDFLARE_ACCOUNT_ID`
  (docs/DEVELOPMENT.md, "Orb credentials"). Never use another key here, and keep all downloaded data out of the repository.
- Bun 1.3.10, and Python 3.11 with torch 2.15 (CPU), numpy 2.4, scipy 1.17, scikit-learn 1.9 and lightgbm 4.7.
- About 13 GB of disk for the recordings of 2026-10-15 to 2026-11-10 and the rows made from them. No GPU.

## Set up

```sh
cp -r tools/botlab /tmp/botlab && cd /tmp/botlab
uv venv .venv --python 3.11 && uv pip install --python .venv/bin/python torch numpy scipy scikit-learn lightgbm
# The lab copy of the shared simulation: the tree of commit 5db8db7 with the lab's changes.
git -C /home/user/workspace/repo archive 5db8db7 shared | tar -x -C sim
(cd sim && patch -s -p1 < shared-5db8db7.patch && ln -s /home/user/workspace/repo/node_modules node_modules)
```

`sim/shared` then has the bot script of the repository with a hook for a learned aim (`LAB` in `bots.ts`), the bot
script of before 2026-11-13 as `bots_old.ts`, and a switch that puts one team on it (`AB.old` in `sim.ts`).
`s1/sync.sh` and `st2/sync.sh` copied newer bot files of the repository into it. Do not run `st2/sync.sh` on a
tree after 2026-11-14: its patch (`st2/patch_lab.py`) needs the `bots.ts` of commit 425f6f0.

## The order of the work

Each script says what it does and how to call it in its first lines.

1. **Download** (read key): `bun inv.ts` (the admin summary and the quality files), `bun dl.ts` (segments and input
   batches), `bun dl2.ts` (key lists and manifests). `bun recount.ts` and `recount_cmp.py` count the clean hours
   again from the local copy.
2. **Rows**: `bun extract.ts 0 2` and `bun extract.ts 1 2` write the aim rows (30 Hz) and the movement rows (10 Hz)
   of players and recorded bots to `/tmp/rec/ds`. `ds.py` loads them, `rows.ts` has the row format, and
   `build_feat.py` makes the inputs of the aim network (`feat.py`; its TypeScript twin is `sim/policy.ts`).
3. **What the players do**: `summary.py`, `inventory.py`, `run_metrics.py` with `metrics.py`, `routes.py`,
   `decisions.py`, `tickrate.py`, `bun tickdt.ts`, and the smaller measurements next to them.
4. **Models**: `train.py` (the aim network; `--hours` gives the learning curve) and `mtrain.py` (the movement
   model). `fit.py`, `clfit.py` and `mfit.py` fit the curves and make the forecasts.
5. **Closed loop**: `bun sim/run.ts` plays bot-only matches in the lab simulation, with the script's aim or a
   trained network on one team, and writes result lines and aim rows. `final.py` runs the named configurations on
   three maps and two sides, and `agg.py` makes the table.
6. **Human-like**: `disc.py` (the human-or-agent classifier), `final_metrics.py` and `st2/dist.py` (the graded
   distance), `sim_metrics.py`.
7. **The bot bench's numbers**: `export_human.py <out.json>` writes the table that is `scripts/botbench/human.json`. `s2/visits_human.py`,
   `s2/mkplaces_repo.py <out.ts>` and `bun s2/placefix.ts` make the table that is `shared/match/places.ts`.
8. **Charts**: `charts/make.py` builds the four chart pages from the result files.

## The directories

- `sim/`: the closed-loop harness (`run.ts`, `policy.ts`, `rows.ts`, `duel.ts`, `movehabits.ts`, `visits.ts`) and
  the checks of the TypeScript inputs against the Python ones (`parity.ts`, `parity2.ts`).
- `s1/`, `s2/`, `s3/`: Stage 1, the bots' habits, buy table and places. The `p_*.py` and `patch_*.py` files are
  patches that were tried on the lab copy of `bots.ts`.
- `st2/`: Stage 2, the learned aim. The 432-round test is `./exit.sh <name> --model <model> --skill 2 --ads 1
  --delay 0 --scan 6 --temp 0.8 --firebias 1`. The network of the test is from
  `.venv/bin/python train.py ochd5 --cond outcome --histdrop 0.5` (about 100 s). `quant.py` checks 8-bit and 16-bit
  weights, and `export_ts.py` writes a network as a TypeScript module.
- `modcost/`: the cost of a learned aim in the server tick (`aimbench.ts`, and the hook that was put into a lab
  copy of the module). `estimate.py` reads result files that are not here.
- `botclip/`: clips of bot play made frame by frame in an orb; it has its own README. The clips of 2026-11-14 need
  the learned aim (`&learned=1`), which is not on `dev`.

A trained network holds what it learned from the players, and a deletion of a player's recordings does not change
it (docs/RECORDING.md, "Deletion"). Get the owner's approval before a trained network goes into the repository.
