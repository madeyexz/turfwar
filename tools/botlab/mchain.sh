#!/bin/bash
# Movement model runs, in order of value. One torch thread (the closed-loop runs use the other core).
cd /tmp/botlab
export TORCH_THREADS=1
P="nice -n 5 .venv/bin/python mtrain.py"
$P mvnh --zero hist --hours 1 4 16 64 0 --seeds 0
$P mv --hours 1 16 0 --seeds 0
$P mvnh-mouse --zero hist --train mouse --hours 4 16 0 --seeds 0
$P mvnh-touch --zero hist --train touch --hours 16 0 --seeds 0
$P mvnh-nopos --zero hist+pos --hours 0 --seeds 0
$P mvnh --zero hist --hours 1 4 16 64 --seeds 1
touch /tmp/rec/out/mchain.done
