#!/usr/bin/env bash
# Delete the commitlog segments and snapshots a STOPPED SpacetimeDB standalone server no longer
# needs. SpacetimeDB 2.10.2 compresses old segments but never deletes them, and our 30 Hz tick
# writes ~1.7 GB of log per busy 6v6 room-hour, so a self-hosted disk fills without this.
#
# Restore loads the newest complete snapshot S and replays the log from S+1 (it never reads from
# offset 0), so segments that end before S+1 are dead weight. This keeps the newest KEEP complete
# snapshots and every segment from the one holding (oldest kept snapshot)+1, so a corrupt newest
# snapshot can still fall back to the one before it. It never deletes the newest segment: an empty
# log makes the server ignore its snapshots and start an EMPTY database.
#
#   deploy/selfhost/prune-commitlog.sh /stdb/data           # dry run: print what would go
#   deploy/selfhost/prune-commitlog.sh /stdb/data --apply   # delete
#   --keep N   complete snapshots to keep per database (default 2)
set -eo pipefail

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
data=""; apply=0; keep=2
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --keep) keep="$2"; shift ;;
    -h|--help) usage ;;
    -*) usage ;;
    *) [ -z "$data" ] || usage; data="${1%/}" ;;
  esac
  shift
done
[ -n "$data" ] && [ -d "$data/replicas" ] || { echo "not a SpacetimeDB data dir: ${data:-<none given>}" >&2; exit 2; }
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || { echo "--keep must be a positive integer" >&2; exit 2; }

# A running server holds data/spacetime.pid; never prune underneath it.
if [ -f "$data/spacetime.pid" ]; then
  pid=$(tr -dc '0-9' < "$data/spacetime.pid")
  if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
    echo "SpacetimeDB is running (pid $pid); stop it before pruning" >&2; exit 1
  fi
fi

# File and directory names start with a zero-padded transaction offset.
offset() { local name="${1##*/}"; echo $((10#${name%%.*})); }

pruned=0
for replica in "$data"/replicas/*; do
  clog="$replica/clog"; snaps="$replica/snapshots"
  [ -d "$clog" ] && [ -d "$snaps" ] || continue

  # Complete snapshot: <S>.snapshot_dir holding <S>.snapshot_bsatn, with no <S>.lock beside it.
  # Globs sort lexically, which is numeric order for the zero-padded names.
  complete=()
  for dir in "$snaps"/*.snapshot_dir; do
    [ -d "$dir" ] || continue
    s="${dir##*/}"; s="${s%.snapshot_dir}"
    [ -f "$dir/$s.snapshot_bsatn" ] && [ ! -e "$snaps/$s.lock" ] && complete+=("$s")
  done
  if [ "${#complete[@]}" -lt "$keep" ]; then
    echo "${replica#"$data"/}: ${#complete[@]} complete snapshot(s), nothing to prune"; continue
  fi
  anchor=$((10#${complete[${#complete[@]} - keep]}))

  # The segment holding anchor+1 is the last one starting at or before it; earlier ones go.
  cut=""
  for seg in "$clog"/*.stdb.log; do
    [ -f "$seg" ] || continue
    start=$(offset "$seg")
    [ "$start" -le $((anchor + 1)) ] && cut="$start"
  done
  if [ -z "$cut" ]; then
    echo "${replica#"$data"/}: no segment holds offset $((anchor + 1)); leaving it alone" >&2; continue
  fi

  victims=()
  for seg in "$clog"/*.stdb.log; do
    [ -f "$seg" ] && [ "$(offset "$seg")" -lt "$cut" ] || continue
    victims+=("$seg")
    [ -e "${seg%.log}.ofs" ] && victims+=("${seg%.log}.ofs")
  done
  for entry in "$snaps"/*; do
    [ -e "$entry" ] || continue
    name="${entry##*/}"
    [[ "$name" =~ ^[0-9]+\. ]] || continue
    case "$name" in
      *.invalid_snapshot|*.archived_snapshot) victims+=("$entry") ;; # set aside by the server itself
      *.snapshot_dir|*.lock) [ "$(offset "$entry")" -lt "$anchor" ] && victims+=("$entry") ;;
    esac
  done

  if [ "${#victims[@]}" -eq 0 ]; then echo "${replica#"$data"/}: nothing to prune"; continue; fi
  # Snapshots hardlink unchanged objects, so this can overstate what deleting frees.
  mb=$(( $(du -skc "${victims[@]}" | tail -1 | cut -f1) / 1024 ))
  verb="would delete"; [ "$apply" = 1 ] && verb="deleting"
  echo "${replica#"$data"/}: keeping snapshots from offset $anchor and the log from segment $cut; $verb ${#victims[@]} files/dirs (up to $mb MB)"
  if [ "$apply" = 1 ]; then rm -rf -- "${victims[@]}"; pruned=1; else printf '  %s\n' "${victims[@]#"$replica"/}"; fi
done
[ "$apply" = 1 ] && [ "$pruned" = 0 ] && echo "nothing pruned"
exit 0
