#!/bin/bash
# Closed-loop rows on taipei by training hours (for the human-or-agent test by hours): plain BC and the outcome variant with ADS.
cd /tmp/botlab
for sb in 100 200; do
  .venv/bin/python final.py bch0.5 bch2.0 bch8.0 lc0.5s0@1 lc2.0s0@1 lc8.0s0@1 --maps taipei --rows 1 --suffix '~t' --seedbase $sb
done > /tmp/rec/out/final-e.log 2>&1
touch /tmp/rec/out/final-e.done
