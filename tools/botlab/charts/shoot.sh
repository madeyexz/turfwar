#!/usr/bin/env bash
# Captures each test page at 2x. Usage: shoot.sh <name>...
set -uo pipefail
export AGENT_BROWSER_NAMESPACE=charts
S=chartview
cleanup() { agent-browser --session "$S" close >/dev/null 2>&1 || true; }
trap cleanup EXIT
first=1
for name in "$@"; do
	for w in 720 360; do
		agent-browser --session "$S" open "file:///tmp/botlab/charts/out/t-$name-$w.html" >/dev/null
		if [ "$first" = 1 ]; then agent-browser --session "$S" set viewport 800 760 2 >/dev/null; first=0; agent-browser --session "$S" open "file:///tmp/botlab/charts/out/t-$name-$w.html" >/dev/null; fi
		agent-browser --session "$S" eval "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))" >/dev/null
		out="/tmp/botlab/charts/shots/$name-$w.png"
		rm -f "$out"
		agent-browser --session "$S" screenshot "#wrap" "$out" >/dev/null
		test -f "$out" && echo "$name-$w dpr=$(agent-browser --session "$S" eval devicePixelRatio) $(stat -c %s "$out") bytes h=$(agent-browser --session "$S" eval "document.getElementById('wrap').getBoundingClientRect().height")"
	done
done
cleanup
trap - EXIT
