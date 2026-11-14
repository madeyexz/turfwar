#!/bin/bash
# Lab: sync the repo bots, apply patches (python files with arguments, as "file.py arg arg"), then the visit maps of the new script and the comparison.
# Usage: vis.sh label "patch.py args" ...
label=$1; shift
F=/tmp/botlab/sim/shared/match/bots.ts
/tmp/botlab/s1/sync.sh
for e in "$@"; do set -- $e; f=$1; shift; python3 /tmp/botlab/s2/$f $F "$@" || exit 1; done
cd /tmp/botlab/sim && timeout 50 bun visits.ts --script new --maps ${MAPS:-taipei,ochre,memorial,warehouse} --rounds ${ROUNDS:-14} --seed 1 --out /tmp/rec/s2/visits-$label.json >/dev/null
cd /tmp/botlab && PYTHONPATH=/tmp/botlab .venv/bin/python s2/visits_cmp.py $label=/tmp/rec/s2/visits-$label.json | cut -c1-200
PYTHONPATH=/tmp/botlab .venv/bin/python s2/visits_cmp.py $label=/tmp/rec/s2/visits-$label.json --late | cut -c1-90
