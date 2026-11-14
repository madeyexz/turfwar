#!/bin/bash
cd /tmp/botlab
while ! grep -q DONE /tmp/rec/out/final-a.log; do sleep 3; done
.venv/bin/python final.py bc+rules nohist outcome1 both1 both1+rules both0+ads both-1+ads both2+ads --rows 0 > /tmp/rec/out/final-b.log 2>&1
while [ ! -f /tmp/rec/out/train-oclc.done ]; do sleep 3; done
.venv/bin/python final.py lc0.5s0@1 lc2.0s0@1 lc8.0s0@1 lc0.5s1@1 lc2.0s1@1 lc8.0s1@1 lc29.7s1@1 > /tmp/rec/out/final-c.log 2>&1
.venv/bin/python final.py bots0.3 bots0.6 bc both1+ads both2+rules --seedbase 200 --rows 1 > /tmp/rec/out/final-d.log 2>&1
touch /tmp/rec/out/final-chain.done
