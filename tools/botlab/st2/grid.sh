#!/bin/bash
# grid.sh <log> <maps> <seeds> "<name>|<args>" ... : each variant on each map and seed (two runs at a time), then DONE.
LOG=$1; MAPS=$2; SEEDS=$3; shift 3
cd /tmp/botlab/st2
for v in "$@"; do name=${v%%|*}; args=${v#*|}; for m in $MAPS; do for s in $SEEDS; do echo "$name-s$s $m $s $args"; done; done; done | xargs -P 2 -I{} bash -c './v.sh {}' >> $LOG 2>&1
echo DONE >> $LOG
