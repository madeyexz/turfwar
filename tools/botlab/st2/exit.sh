#!/bin/bash
# exit.sh <name> <args...> : the 432-round test of one variant of the learned aim against the new script bots at skill 0.3:
# taipei, ochre and memorial, the two sides, two seeds, 36 rounds each, all with the MP5. Rows of the taipei runs go to /tmp/rec/st2/exit/.
# Prints one line per run, then the kill share (mean and standard error of the 12 runs), the rounds won and the distance to the players.
name=$1; shift; args="$*"
O=/tmp/rec/st2/exit; mkdir -p $O; rm -f $O/$name.jsonl $O/$name-*.f32
cd /tmp/botlab/sim
for sb in 100 200; do mi=0; for mp in taipei ochre memorial; do for side in 0 1; do
  rows=""; [ $mp = taipei ] && rows="--rows $O/$name-$sb-$side"
  echo "bun run.ts --map $mp --size 6 --rounds 36 --seed $((sb + mi * 10 + side)) --loadout mp5 --proto $side --oldteam $( [ "${OLD:-none}" = none ] && echo none || echo $((1 - side)) ) --botskill ${BOTSKILL:-0.3} --tag $name@$side --out $O/$name.jsonl $rows $args"
done; mi=$((mi + 1)); done; done | xargs -P 2 -I{} bash -c '{} > /dev/null 2>&1'
cd /tmp/botlab && .venv/bin/python st2/exit.py $name
