#!/bin/bash
# Follow-up movement runs: is the 15,000-step limit binding at the large sizes, and does a larger model gain?
cd /tmp/botlab
export TORCH_THREADS=1
P="nice -n 5 .venv/bin/python mtrain.py"
$P mvnh-long --zero hist --hours 16 64 0 --seeds 0 --max_steps 60000
$P mvnh-big --zero hist --hours 16 0 --seeds 0 --hidden 128 --layers 3 --max_steps 60000
touch /tmp/rec/out/mchain2.done
