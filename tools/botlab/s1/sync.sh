#!/bin/bash
# Copy the repository's bot files to the lab copy of the shared simulation (the lab keeps the old script as bots_old.ts).
set -e
R=/home/user/workspace/repo/shared/match; L=/tmp/botlab/sim/shared/match
cp $R/bots.ts $L/bots.ts
printf '\n/** Lab only: the hooks of the learned aim (not used by this script). */\nexport const LAB: { before?: any; after?: any } = {};\n' >> $L/bots.ts
cp $R/state.ts $L/state.ts
cp $R/economy.ts $L/economy.ts
cp $R/combat.ts $L/combat.ts
cp $R/places.ts $L/places.ts
cp $R/nav.ts $L/nav.ts
