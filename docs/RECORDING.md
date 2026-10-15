# Match recording

Online matches on the Taipei server are recorded to train bots that move and aim like people, and to
make a de-identified dataset that may be licensed to companies that build AI. Players accept this by
pressing Play (clickwrap next to the button: the Terms at `/terms` and `/privacy`), and can leave with
**Settings → Exclude my matches from datasets** (Global Privacy Control or Do Not Track turns it on;
the CrazyGames build is always left out). Only matches played after the change (2026-10-15, Terms
version 1) are recorded. The plan with the forecast and the reasons is kept outside the repo; this file
describes what runs.

```
 browser (online match)                     Taipei VM (turfwar-tw)                         Cloudflare
┌──────────────────────┐  consent reducer  ┌───────────────────────┐
│ src/game/consent.ts  ├──────────────────▶│ SpacetimeDB turfwar   │
│ src/game/inputlog.ts │                   │  player_consent       │
└──────────┬───────────┘                   │  recorder_subjects ◀──┼── admin-only view
           │ POST /v1/input (gzip, token)  └──────────┬────────────┘
           ▼                                          │ SDK subscription (localhost)
┌──────────────────────┐                   ┌──────────▼────────────┐   ┌──────────────────────┐
│ Worker rec-ingest    │                   │ turfwar-recorder      │   │ R2 turfwar-rec       │
│ rec.turfwar.…        ├──────────────────▶│  segment per round    ├──▶│  v1/seg, manifest,   │
│ ES256 check, pid     │  input/, index/   │ turfwar-rec-process   │   │  input, index, optout│
└──────────────────────┘                   │  (hourly)             ├──▶│  quality, stats      │
                                           └───────────────────────┘   └──────────┬───────────┘
                                                                                   │ offline export
                                                                       ┌───────────▼──────────┐
                                                                       │ R2 turfwar-export    │
                                                                       └──────────────────────┘
```

## Who is recorded

A **recording subject** is a human in an Online room on Taipei (`turfwar`) or `lawbreaker-dev` whose
`player_consent` row says Terms version ≥ 1 (`REC_TERMS_VERSION`), not excluded, platform not
CrazyGames. The client sends `consent` on connect and whenever the switch changes
(`src/net/online.ts`); the recorder reads the admin-only `recorder_subjects` view. Everyone else in the
room — older clients, players who switched datasets off — is **blanked** in every frame
(`zeroSoldiers`: pose zeros, their shots lose shooter and coordinates, no vehicle seat or bomb names
them) and keeps no pid. A round with no subject is not stored. Chat, callsigns and text are never stored.

`pid = HMAC-SHA256(REC_SALT, "turfwar:<env>:<identity hex>")`, first 16 bytes (`shared/rec/policy.ts`).
The identity itself is never stored in R2. `REC_SALT` is an Amp project secret, a Worker secret and a
line in the VM's `/etc/turfwar-rec/env`; losing it breaks deletion by identity (deletion by pid still works).

## What is stored

Bucket **`turfwar-rec`** (internal set; Taipei under `v1/`, `lawbreaker-dev` under `dev/v1/`):

| Key | Written by | Contents |
| --- | --- | --- |
| `v1/seg/dt=YYYY-MM-DD/room=RRR/<match>-r<round>-<tick>.tfr.zst` | recorder | one round of one room (`shared/rec/segment.ts`, zstd) |
| `v1/manifest/…/<same>.json` | recorder | sizes, sha256, versions, map/mode, gap ratio, subject pids |
| `v1/input/dt=…/pid=<pid>/s=<session>/b=NNNNN.til.gz` | Worker | one 30-s input batch (`shared/rec/inputlog.ts`, gzip) |
| `v1/index/pid=<pid>/…` | Worker, recorder | the player-to-file index (deletion) |
| `v1/optout/pid=<pid>.json` | recorder, `rec-delete` | players who switched datasets off (later exports leave out all their matches) |
| `v1/quality/…/<same>.json` | processor | clean-rules result per subject-round |
| `v1/stats/clean-hours.json`, `v1/stats/recount.json` | processor, recount | the admin summary |

**Segment** (`.tfr`): "TFR1", header JSON (versions: `recFormat`, `frameVersion`, recorder git SHA,
module hash, map id and hash, match config, mode, size, room kind, random match id, round, ticks
expected/received, gap ratio, ticks/s, truncated, the soldiers with team, bot, pid, device, region
flag), then records: the packed frame exactly as the server sent it (30/s), filtered events (kill,
damage, round, bomb, …; never chat), roster changes without names, and tick gaps.

**Input batch** (`.til`): "TIL1", header JSON (session, batch number, build, database, room, soldier id,
device type, `touch`, `assist` (touch aim assist on), sensitivity, FOV, DPR, the bound key codes and the
game actions they map to), then varint-timed records: pointer-lock mouse movement (coalesced events when
they add up), keys and mouse buttons bound to game actions (others are "other"; nothing while a text
field has focus), wheel, touches (normalized), and per rendered frame the look input it consumed, the
radians per pixel applied, **the aim-assist correction (`assistYaw`, `assistPitch`, `assistScale`)**, the
aim after, alive, and the newest server tick with its age; movement reports and shots sent, report round
trips, focus/visibility/pointer-lock changes and sensitivity changes.

## Clean

`shared/rec/clean.ts`, rules `clean-v1`. The unit is one second of one subject alive in a live round.
A subject-round is dropped whole for: leaving or changing team (E5); report round trip p95 > 250 ms,
> 3 corrections per minute, frame gap ratio > 2 % or an input gap > 1 s while alive (E6); > 2 shots the
server did not take (E8); median client-vs-server yaw error > 2° or a clock-fit residual > 3 ticks
(E9); input-log coverage < 90 % of alive live ticks (E10, "server-only"). AFK stretches (no input, no
movement, no turning for 10 s, plus 2 s each side) are cut; a round more than half AFK goes (E4).

Two measures:

- **Movement-clean**: every rule above. Touch play with aim assist counts (its correction is logged).
- **Aim-clean**: the same, but only mouse play or touch with assist off (E7).

Targets (`TARGETS`): **200 h movement-clean** and **50 h aim-clean** for bot training, **1,000 h** of the
export set for the dataset. Each quality record keeps `device` (phone, tablet, desktop), `input` (touch,
mouse) and `aimAssist`.

## Services

- **Worker `turfwar-rec-ingest`** (`deploy/cloudflare/rec-ingest/`): `POST /v1/input` checks the
  SpacetimeDB token's ES256 signature against the server's public key (Taipei for `turfwar`, Maincloud for
  `lawbreaker-dev`; embedded, redeploy if a key changes), refuses GPC/DNT, caps a batch at 256 KB
  (4 MB inflated), checks the batch header, stores it under the pid. `GET /v1/stats` returns the summary
  (and the newest recount) to the admin key (the Worker holds only its sha256).
- **Recorder** (`tools/recorder/recorder.ts`, systemd `turfwar-recorder` on the VM): SDK client of the
  local server, admin login, subscribes to every room's `frame`, `match_event`, `roster`, `match`,
  `private_room` and `recorder_subjects`; cuts a segment per round (`shared/rec/segmenter.ts`; rounds
  over 10 minutes are split; a room whose frames stop closes after 30 s), spools it to
  `/var/lib/turfwar-rec/spool` (2 GB cap) and uploads it with an ETag (MD5) check, then the manifest and
  the index. Health line every minute in `journalctl -u turfwar-recorder`.
- **Processor** (`tools/recorder/process.ts`, `turfwar-rec-process.timer`, hourly): classifies new
  segments (10 minutes after upload, so the input batches are in), rewrites `stats/clean-hours.json`, and
  at 19:00 UTC applies retention: input never used by a segment after 30 days, everything after 3 years.
- **Admin**: `/admin` → Recording shows movement-clean vs 200 h, aim-clean vs 50 h, export-set hours vs
  1,000 h, per day, by device and input, the checks and the recount. It asks for the admin key once per
  visit (memory only).

## Proof

- `bun scripts/rec-recount.ts [--env dev] [--write]` — lists the segments themselves, checks sha256
  against the manifests, classifies again from raw files and sums movement-clean and aim-clean seconds
  with its own loop; fails if they differ from the admin numbers by > 1 %. Run weekly (with `--write`,
  VM keys) and before a training run.
- Kill reconciliation (every kill event's victim dies in the frames within ±2 ticks) and the frame gap
  ratio are in every quality file and on the admin card.
- `/dev/replay.html` — a top-down replay of a segment or an export file (decompress with `zstd -d`).
- `bun scripts/rec-bias.ts` — clean hours by device, input, map, mode, size, Taipei hour and player
  concentration, next to all recorded hours.

## Deletion

`bun scripts/rec-delete.ts --identity <hex>` (or `--pid`): deletes the player's input batches, rewrites
every segment they are in with their soldier blanked and their pid removed, drops the stale quality
files (the processor recounts), and writes an opt-out marker so no later export holds them. Needs
`REC_SALT` and the VM keys. A player's game ID is their SpacetimeDB identity.

## Export

`bun tools/recorder/export.ts [--env dev] [--dry-run]` with the `R2_REC_EXPORT_*` keys (read
`turfwar-rec`, write `turfwar-export`). Selection: public rooms only; a match goes whole or not at all —
it is left out when any human in any round was not a subject, was in the EU, EEA, UK or Switzerland (or
an unknown region), or has opted out since. Each match becomes one `.tfx` file (`shared/rec/export.ts`):
new random soldier and body ids per file (frames, shots, bomb, vehicle seats, events, roster), ticks from
0, no wall-clock times, no names, chat, pids, match/room/session ids, build or module hashes, key codes,
sensitivity or round trips; controls become rows of view-angle changes (radians) and game actions, with
the assist correction; each soldier keeps team, bot, device type, input type and `aimAssist`. The date is
the Taipei day, or the ISO week when fewer than 5 matches share it. Checks before a file is written: an
allow-list scan of every field, no internal id of the match in the bytes, and a decode. Each run is a
complete snapshot `export-v1/run=<id>/` with a manifest; older runs are deleted after it, so opt-outs
leave every later export. Buyers must sign a contract that forbids re-identification.

## Install and keys

| Key | Where | Can |
| --- | --- | --- |
| `turfwar-rec-vm` (`R2_REC_VM_*`) | VM env, Amp project secret | read/write `turfwar-rec` |
| `turfwar-rec-read` (`R2_REC_READ_*`) | Amp project secret | read `turfwar-rec` (recount, bias) |
| `turfwar-rec-export` (`R2_REC_EXPORT_*`) | Amp project secret | read `turfwar-rec`, write `turfwar-export` |
| `REC_SALT` | Amp project secret, Worker secret, VM env | pids |

R2 S3 keys are account API tokens: access key id = token id, secret = sha256 of the token value.
Install or update on the VM from an orb: `deploy/gcp-taipei/recorder/deploy.sh` (`--env` rewrites
`/etc/turfwar-rec/env` from the shell's secrets). Worker: `bun deploy/cloudflare/rec-ingest/deploy.ts`.
Local test: run `amp orb services ensure`, then the recorder with `STDB_URI=ws://127.0.0.1:3000
REC_ENV=dev REC_PREFIX=test/v1` (any prefix keeps test data apart), and remove the prefix afterwards.
