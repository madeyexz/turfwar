#!/bin/bash
# Lab-only ablation with the window distance: sync the repo bots, apply patches to the lab copy (a *.py argument is run with the
# lab file's path, any other argument is a sed -E expression), then the quick screen (taipei, ochre), the taipei rows and the distance.
# Usage: abl2.sh label patch ...
label=$1; shift
F=/tmp/botlab/sim/shared/match/bots.ts
/tmp/botlab/s1/sync.sh
for e in "$@"; do case "$e" in *.py) python3 "$e" $F || exit 1;; *) sed -i -E "$e" $F;; esac; done
cd /tmp/botlab
out=$(s1/q.sh 12 "taipei ochre")
echo "$label: $(echo "$out" | grep -E 'side' | awk '{printf "%s%s %s | ", $1, $3, $7}') $(echo "$out" | grep TOTAL)"
.venv/bin/python final.py new0.3 --rounds 36 --size 6 --maps taipei --rows 1 --suffix x$label | grep side | cut -c1-100
.venv/bin/python featcmp.py x=/tmp/rec/final/new0.3x$label-100-0-bot.f32,/tmp/rec/final/new0.3x$label-100-1-bot.f32 > /tmp/botlab/s1/feat-$label.txt
grep distance /tmp/botlab/s1/feat-$label.txt
awk '/d=/{print $NF, $1}' /tmp/botlab/s1/feat-$label.txt | sort -rn | head -8 | tr '\n' ';'; echo
/tmp/botlab/s1/sync.sh
