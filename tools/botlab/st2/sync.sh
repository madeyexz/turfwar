#!/bin/bash
# Copy the repository's bot files to the lab copy of the shared simulation, then add the lab hook of the learned aim to bots.ts.
set -e
R=/home/user/workspace/repo/shared/match; L=/tmp/botlab/sim/shared/match
for f in bots.ts state.ts economy.ts combat.ts places.ts nav.ts; do cp $R/$f $L/$f; done
python3 /tmp/botlab/st2/patch_lab.py $L/bots.ts
