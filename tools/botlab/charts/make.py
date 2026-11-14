"""Builds the four chart views from the saved result files. Each view is one self-contained HTML file."""
import json
import os

OUT = '/tmp/rec/out'
HERE = os.path.dirname(os.path.abspath(__file__))
COMMON_JS = open(os.path.join(HERE, 'common.js')).read()
COMMON_CSS = open(os.path.join(HERE, 'common.css')).read()


def load(name):
    return json.load(open(os.path.join(OUT, name)))


def page(header, body_js, data, height, key=''):
    return (
        '<div class="ui-header">\n\t<p class="ui-title" id="title"></p>\n\t<p class="ui-sub" id="sub"></p>\n</div>\n'
        + key
        + '<svg id="chart" class="lc" width="100%%" height="%d" tabindex="0" role="img"></svg>\n' % height
        + '<p class="ui-caption" id="readout" style="margin-top: 4px">&nbsp;</p>\n'
        + '<p class="ui-caption" id="note" style="margin-top: 8px; max-width: 65ch; text-wrap: pretty"></p>\n'
        + '<style>\n' + COMMON_CSS + '</style>\n'
        + '<script>\n{\n' + COMMON_JS + '\nconst D = ' + json.dumps(data, separators=(',', ':')) + '\n'
        + 'const $ = (id) => document.getElementById(id)\nconst svg = $("chart")\nconst H = %d\n' % height
        + body_js + '\n}\n</script>\n'
    )


# ---------- 1. Aim model, open loop ----------
fit = load('fit.json')
train = [json.loads(l) for l in open(os.path.join(OUT, 'train.jsonl'))]
cap = []
for d in train:
    if abs(d['hours'] - 29.73) < 0.05 and d['seed'] == 0 and d.get('exp', '') != '':
        cap.append({'hidden': d['hidden'], 'layers': d['layers'], 'mirror': d['mirror'], 'params': d['params'], 'nll': d['test']['nll'], 'exp': d['exp']})
# keep one row per (hidden, layers, mirror) from the plain BC experiments
seen = {}
for c in cap:
    seen.setdefault((c['hidden'], c['layers'], c['mirror']), c)
cap = sorted(seen.values(), key=lambda c: c['params'])
mirror_small = [c for c in cap if c['hidden'] == 64 and c['layers'] == 2 and c['mirror']][0]['nll']
aim = {
    'measured': [[float(h), p['mean'], p['sd'], p['n']] for h, p in fit['lc.points'].items()],
    'fit': {k: fit['lc.nll'][k] for k in ('a', 'b', 'c')},
    'forecast': [[float(h), p['value'], p['lo'], p['hi']] for h, p in fit['lc.nll']['pred'].items()],
    'cap': cap,
    'prior': fit['prior_nll'],
    'asym': fit['lc.nll']['asymptote_90'],
    'mirror_small': mirror_small,
}
aim['measured'][-1][0] = 29.73
AIM_JS = r"""
const last = D.measured[D.measured.length - 1]
const f1000 = D.forecast[D.forecast.length - 1]
const small = D.cap.find((c) => c.hidden === 64 && c.layers === 2 && !c.mirror)
const big = D.cap[D.cap.length - 1]
const times = Math.round(big.params / small.params)
const n3 = (v) => v.toFixed(3)
const fitAt = (h) => D.fit.a + D.fit.b * Math.pow(h, -D.fit.c)
$('title').textContent = `Aim loss is flat after 30 hours: ${Math.round(f1000[0] / last[0])} times more data is forecast to gain ${n3(last[1] - f1000[1])} nats, and a larger model gains ${n3(small.nll - big.nll)} today`
$('sub').textContent = `Test loss of the aim model by hours of aim-clean training data, log scale. Lower is better.`
$('note').textContent = `Loss is the negative log likelihood per 30 Hz tick, summed over the yaw, pitch and fire outputs, on 52 players that the model did not see (8.25 h). A model with no input scores ${n3(D.prior)}. Solid points are the mean of ${last[3]} seeds of the 64×2 network (${small.params.toLocaleString('en-US')} parameters). Hollow points are the fit ${n3(D.fit.a)} + ${n3(D.fit.b)}·h^−${n3(D.fit.c)} with its 90% range. The larger model is 256×3 with mirrored samples (${big.params.toLocaleString('en-US')} parameters, one seed). The same seed of the small model scores ${n3(small.nll)}, and ${n3(D.mirror_small)} with mirrored samples, so the gain comes from the size.`
const points = [
	...D.measured.map(([h, v, sd]) => ({ x: h, y: v, text: `${h} h measured: ${n3(v)} nats (SD ${n3(sd)} over seeds)` })),
	...D.forecast.map(([h, v, lo, hi]) => ({ x: h, y: v, text: `${h.toLocaleString('en-US')} h forecast: ${n3(v)} nats (90% range ${n3(lo)} to ${n3(hi)})` })),
]
points.push({ x: last[0], y: big.nll, text: `Model ${times}× larger at ${last[0]} h: ${n3(big.nll)} nats` })
const home = points.length - 1
chart(svg, $('readout'), {
	H, log: true, x0: 0.5, x1: 1000, y0: 3.05, y1: 3.42, L: 36, R: 8, points, home,
	build(c) {
		const ys = [3.1, 3.2, 3.3, 3.4]
		let s = P.grid(c, ys)
		s += P.line(c, D.measured.map(([h, v]) => [h, v]), 'var(--chart-1)', 2)
		s += P.line(c, P.curve(fitAt, last[0], 1000, 40), 'var(--chart-1)', 2, '2 5')
		for (const [h, v, lo, hi] of D.forecast) s += P.whisker(c, h, lo, hi, 'var(--chart-context)')
		for (const [h, v] of D.measured) s += P.dot(c, h, v, 'var(--chart-1)', false, 2.5)
		for (const [h, v] of D.forecast) s += P.dot(c, h, v, 'var(--chart-1)', true, 3)
		s += P.dot(c, last[0], big.nll, 'var(--chart-2)', false, 3.5)
		s += P.gridLabels(c, ys, (v) => (v === 3.4 ? '3.4 nats' : v.toFixed(1)))
		s += P.xTicks(c, [
			{ v: 0.5, label: '0.5 h' }, { v: 2, label: '2 h', thin: true }, { v: 8, label: '8 h' },
			{ v: 30, label: '30 h' }, { v: 115, label: '115 h', thin: true }, { v: 1000, label: '1,000 h' },
		])
		// Narrow: the two labels do not fit side by side above the line, so the forecast label goes below its range bar.
		s += P.text(c.x(last[0]) - (c.thin ? 6 : 0), c.y(last[1]) - 10, `${last[0]} h: ${n3(last[1])}`, c.thin ? 'start' : 'middle', 'var(--foreground)')
		s += P.text(c.x(1000), c.thin ? c.y(f1000[2]) + 16 : c.y(f1000[3]) - 8, `1,000 h forecast: ${n3(f1000[1])}`, 'end', 'var(--foreground)')
		s += P.text(c.x(last[0]) - 8, c.y(big.nll) + 12, c.thin ? `${times}× larger model: ${n3(big.nll)}` : `Model ${times}× larger, same data: ${n3(big.nll)}`, 'end', 'var(--chart-2)')
		return s
	},
})
"""

# ---------- 2. Closed loop ----------
cl = load('clfit.json')
ft = load('final_table.json')
bots = {}
for k in ('bots0.15', 'bots0.3', 'bots0.6', 'bots0.9'):
    v = ft[k + '|6|elimination']
    bots[k[4:]] = {'kill': v['kill_share'], 'se': v['kill_share_se'], 'round': v['round_share'], 'runs': v['runs']}
closed = {
    'points': [[p['hours'], p['seed'], p['kill_share'], p['round_share']] for p in cl['points']],
    'fit': {k: cl['fit'][k] for k in ('K', 'b', 'c')},
    'K90': cl['fit']['K_90'],
    'forecast': [[float(h), p['value'], p['lo'], p['hi']] for h, p in cl['fit']['pred'].items()],
    'bots': bots,
    'bc': {'kill': ft['bc|6|elimination']['kill_share'], 'round': ft['bc|6|elimination']['round_share']},
}
CLOSED_JS = r"""
const pct = (v) => `${Math.round(v * 100)}%`
const fitAt = (h) => D.fit.K - D.fit.b * Math.pow(h, -D.fit.c)
const hours = [...new Set(D.points.map((p) => p[0]))]
const mean = (h) => { const v = D.points.filter((p) => p[0] === h).map((p) => p[2]); return v.reduce((a, b) => a + b, 0) / v.length }
const lastH = hours[hours.length - 1]
const f1000 = D.forecast[D.forecast.length - 1]
const b3 = D.bots['0.3'], b6 = D.bots['0.6'], b9 = D.bots['0.9']
$('title').textContent = `More data takes the learned aim to the level of the current bots and no further: ${pct(f1000[1])} of kills forecast at 1,000 hours, against ${pct(b3.kill)} for the bots`
$('sub').textContent = `Share of kills for a team with the learned aim against a team of current bots at skill 0.3, by hours of training data, log scale`
$('note').textContent = `6v6 Elimination with the MP5 on three maps, both sides, 36 rounds per run, in the shared simulation. The learned model moves the aim and the trigger; the script bot keeps movement, navigation and buying. Points are two training seeds; the line is the fit ${D.fit.K.toFixed(3)} − ${D.fit.b.toFixed(3)}·h^−${D.fit.c.toFixed(3)}, and bars show its 90% range (ceiling ${pct(D.K90[0])} to ${pct(D.K90[1])}). Rules show script bots at other skill levels against the same opponent; a mirror match of the script bots gives ${pct(b3.kill)} (±${(b3.se * 100).toFixed(0)} point), which is 50% within the noise. The model without the outcome input takes ${pct(D.bc.kill)} of kills and wins no round.`
const points = [
	...hours.map((h) => ({ x: h, y: mean(h), text: `${h} h measured: ${pct(mean(h))} of kills (seeds ${D.points.filter((p) => p[0] === h).map((p) => pct(p[2])).join(' and ')})` })),
	...D.forecast.map(([h, v, lo, hi]) => ({ x: h, y: v, text: `${h.toLocaleString('en-US')} h forecast: ${pct(v)} of kills (90% range ${pct(lo)} to ${pct(hi)})` })),
]
const home = points.length - 1
chart(svg, $('readout'), {
	H, log: true, x0: 0.5, x1: 1000, y0: 0, y1: 0.82, L: 36, R: 8, points, home,
	build(c) {
		// 20% steps keep the gridlines away from the three bot rules (51%, 64%, 74%).
		const ys = [0, 0.2, 0.4, 0.6, 0.8]
		let s = P.grid(c, ys, null, 0)
		for (const b of [b3, b6, b9]) s += P.rule(c, b.kill, 36)
		s += P.line(c, P.curve(fitAt, 0.5, lastH, 40), 'var(--chart-1)', 2)
		s += P.line(c, P.curve(fitAt, lastH, 1000, 40), 'var(--chart-1)', 2, '2 5')
		for (const [h, v, lo, hi] of D.forecast) s += P.whisker(c, h, lo, hi, 'var(--chart-context)')
		for (const [h, , v] of D.points) s += P.dot(c, h, v, 'var(--chart-1)', false, 2.5)
		for (const [h, v] of D.forecast) s += P.dot(c, h, v, 'var(--chart-1)', true, 3)
		s += P.gridLabels(c, ys, (v) => (v === 0.8 ? '80% of kills' : pct(v)))
		s += P.xTicks(c, [
			{ v: 0.5, label: '0.5 h' }, { v: 2, label: '2 h', thin: true }, { v: 8, label: '8 h' },
			{ v: 30, label: '30 h' }, { v: 115, label: '115 h', thin: true }, { v: 1000, label: '1,000 h' },
		])
		const lx = c.thin ? 44 : 96
		s += P.text(lx, c.y(b3.kill) - 5, c.thin ? `Bots 0.3: ${pct(b3.kill)}` : `Current bots, skill 0.3: ${pct(b3.kill)}`)
		s += P.text(lx, c.y(b6.kill) - 5, c.thin ? `Bots 0.6: ${pct(b6.kill)}` : `Bots at skill 0.6: ${pct(b6.kill)}`)
		s += P.text(lx, c.y(b9.kill) - 5, c.thin ? `Bots 0.9: ${pct(b9.kill)}` : `Bots at skill 0.9: ${pct(b9.kill)}`)
		// Narrow: only the forecast label fits below the curve; the readout gives the measured value.
		if (!c.thin) s += P.text(c.x(lastH), c.y(mean(lastH)) + 18, `${lastH} h: ${pct(mean(lastH))}`, 'middle', 'var(--foreground)')
		s += P.text(c.x(1000), c.y(f1000[2]) + (c.thin ? 19 : 14), `1,000 h forecast: ${pct(f1000[1])}`, 'end', 'var(--foreground)')
		return s
	},
})
"""

# ---------- 3. Movement ----------
mf = load('mfit.json')
move = {
    'by': [[float(h), v['mouse_nll'], v['touch_nll'], v['n']] for h, v in mf['mvnh.by_hours'].items()],
    'mouse': {'a': mf['mvnh.mouse.nll']['loglin']['a'], 'per4': mf['mvnh.mouse.nll']['loglin']['per_4x'],
              'pow': {h: p['value'] for h, p in mf['mvnh.mouse.nll']['power']['pred'].items()}},
    'touch': {'a': mf['mvnh.touch.nll']['loglin']['a'], 'per4': mf['mvnh.touch.nll']['loglin']['per_4x'],
              'pow': {h: p['value'] for h, p in mf['mvnh.touch.nll']['power']['pred'].items()}},
    'prior': mf['prior'],
    'train_hours': mf['split']['train_hours'],
    'players': mf['split']['players'],
    'big': [b for b in mf['mvnh-big'] if b['hours'] > 80][0]['mouse_nll'],
    'params': {'small': 11091, 'big': 46867},
    'worth': mf['touch_worth']['one_touch_hour_in_mouse_hours'],
}
move['by'][-1][0] = round(mf['split']['train_hours'], 1)
MOVE_JS = r"""
const n3 = (v) => v.toFixed(3)
const n2 = (v) => v.toFixed(2)
const lin = (m) => (h) => m.a - m.per4 * (Math.log(h) / Math.log(4))
const fm = lin(D.mouse), ft = lin(D.touch)
const last = D.by[D.by.length - 1]
$('title').textContent = `The movement model still improves at ${Math.round(last[0])} hours: each 4× of data cuts the loss by ${n2(D.mouse.per4)} nats for mouse and ${n2(D.touch.per4)} for touch`
$('sub').textContent = `Test loss of the movement model by hours of movement-clean training data, log scale. Lower is better.`
$('mk').textContent = `Mouse −${n3(D.mouse.per4)} per 4× hours`
$('tk').textContent = `Touch −${n3(D.touch.per4)} per 4× hours`
$('note').textContent = `Loss is the negative log likelihood per 10 Hz step, summed over the move direction, the turn and the sprint, sights and in-air flags, on ${D.players.test} players that the model did not see. The model gets no action history, so it cannot copy the last step. A model with no input scores ${n3(D.prior.mouse)} (mouse) and ${n3(D.prior.touch)} (touch). Dashed lines continue the straight-line fit. The bar at each forecast point reaches up to a power-law fit, which gives ${n3(D.mouse.pow['1000'])} for mouse at 1,000 h. The data do not identify where the curve stops. A model ${(D.params.big / D.params.small).toFixed(1)} times larger (${D.params.big.toLocaleString('en-US')} parameters against ${D.params.small.toLocaleString('en-US')}) scores ${n3(D.big)} at ${Math.round(last[0])} h, so data limits this model more than size. One touch hour is worth about ${n2(D.worth)} mouse hour for mouse play.`
const fc = [115, 200, 1000]
const points = [
	...D.by.map(([h, m, t]) => ({ x: h, y: m, text: `${h} h measured: mouse ${n3(m)}, touch ${n3(t)} nats` })),
	...fc.map((h) => ({ x: h, y: fm(h), text: `${h.toLocaleString('en-US')} h forecast: mouse ${n3(fm(h))} to ${n3(D.mouse.pow[h])}, touch ${n3(ft(h))} to ${n3(D.touch.pow[h])} nats (straight line to power law)` })),
]
const home = D.by.length - 1
chart(svg, $('readout'), {
	H, log: true, x0: 1, x1: 1000, y0: 2.5, y1: 3.6, L: 36, R: 44, points, home,
	build(c) {
		const ys = [2.6, 2.8, 3.0, 3.2, 3.4, 3.6]
		let s = P.grid(c, ys)
		s += P.line(c, D.by.map(([h, m]) => [h, m]), 'var(--chart-1)', 2)
		s += P.line(c, D.by.map(([h, , t]) => [h, t]), 'var(--chart-2)', 2)
		s += P.line(c, [[last[0], fm(last[0])], [1000, fm(1000)]], 'var(--chart-1)', 2, '2 5')
		s += P.line(c, [[last[0], ft(last[0])], [1000, ft(1000)]], 'var(--chart-2)', 2, '2 5')
		// The bar at each forecast point reaches up to the power-law forecast, the less optimistic of the two fits.
		for (const h of fc) s += P.whisker(c, h, fm(h), D.mouse.pow[h], 'var(--chart-context)') + P.whisker(c, h, ft(h), D.touch.pow[h], 'var(--chart-context)')
		for (const [h, m, t] of D.by) s += P.dot(c, h, m, 'var(--chart-1)', false, 2.5) + P.dot(c, h, t, 'var(--chart-2)', false, 2.5)
		for (const h of fc) s += P.dot(c, h, fm(h), 'var(--chart-1)', true, 3) + P.dot(c, h, ft(h), 'var(--chart-2)', true, 3)
		s += P.gridLabels(c, ys, (v) => (v === 3.6 ? '3.6 nats' : v.toFixed(1)))
		s += P.xTicks(c, [
			{ v: 1, label: '1 h' }, { v: 4, label: '4 h', thin: true }, { v: 16, label: '16 h' },
			{ v: 82, label: '82 h' }, { v: 200, label: '200 h', thin: true }, { v: 1000, label: '1,000 h' },
		])
		// Both lines fall to the right, so the free space is above and right of the upper line and below and left of the lower line.
		s += P.text(c.x(last[0]) + 2, c.y(last[1]) - 9, n3(last[1]), 'start', 'var(--chart-1)')
		s += P.text(c.x(last[0]) - 2, c.y(last[2]) + 17, n3(last[2]), 'end', 'var(--chart-2)')
		s += P.text(c.x(1000) + 8, c.y(fm(1000)) + 4, n3(fm(1000)), 'start', 'var(--chart-1)')
		s += P.text(c.x(1000) + 8, c.y(ft(1000)) + 4, n3(ft(1000)), 'start', 'var(--chart-2)')
		return s
	},
})
"""
MOVE_KEY = '<p class="key"><span id="mk" style="color: var(--chart-1)"></span><span id="tk" style="color: var(--chart-2)"></span></p>\n'

# ---------- 4. Strong against human-like ----------
m = load('metrics-final.json')
A = m['agents']


def ks(tag):
    v = ft[tag + '|6|elimination']
    return {'kill': v['kill_share'], 'se': v['kill_share_se'], 'round': v['round_share'], 'runs': v['runs']}


trade = {
    'control': m['control'],
    'agents': [
        {'key': 'bots3', 'label': 'Current bots, skill 0.3', 'short': 'Bots 0.3', 'dist': A['sim bots 0.3']['distance'], **ks('bots0.3'), 'kind': 'bot'},
        {'key': 'bots6', 'label': 'Bots at skill 0.6', 'short': 'Bots 0.6', 'dist': A['sim bots 0.6']['distance'], **ks('bots0.6'), 'kind': 'bot'},
        {'key': 'bc', 'label': 'Plain imitation', 'short': 'Plain imitation', 'dist': A['plain BC 29.7h']['distance'], **ks('bc'), 'kind': 'bc'},
        {'key': 'oc1', 'label': 'Imitation with the outcome input', 'short': 'Outcome input', 'dist': A['both1+ads 29.7h']['distance'], **ks('both1+ads'), 'kind': 'oc'},
        {'key': 'oc2', 'label': 'Outcome input, level 2, with rules', 'short': 'Level 2 + rules', 'dist': A['both2+rules 29.7h']['distance'], **ks('both2+rules'), 'kind': 'oc'},
    ],
    'recbots': A['recorded bots']['distance'],
    'features': len(m['features']),
}
TRADE_JS = r"""
const pct = (v) => `${Math.round(v * 100)}%`
const n2 = (v) => v.toFixed(2)
const by = Object.fromEntries(D.agents.map((a) => [a.key, a]))
const col = { bot: 'var(--chart-context)', bc: 'var(--chart-1)', oc: 'var(--chart-2)' }
const ratio = by.bots3.dist / by.bc.dist
$('title').textContent = `No agent is human-like and strong together: plain imitation is ${ratio.toFixed(1)} times nearer to humans than the current bots, but it takes ${pct(by.bc.kill)} of the kills`
$('sub').textContent = `Share of kills against the current bots, by distance from human aim. Left is more human-like; up is stronger.`
$('note').textContent = `Distance is the mean over ${D.features} aim features of the Wasserstein-1 distance to the human distribution, divided by the human standard deviation, on 3-second windows with an enemy in sight (Taipei, MP5). Two groups of different human players are ${n2(D.control.distance)} apart (random splits ${n2(D.control.splits_p05_p95[0])} to ${n2(D.control.splits_p05_p95[1])}). The bots in the recordings are at ${n2(D.recbots)}. Kill share is from 6v6 Elimination on three maps and both sides, against script bots at skill 0.3; bars show one standard error. All learned agents use 29.7 h of data. Plain imitation copies the next aim action of the recorded players. The outcome input adds the number of hits that the player made in the next 1.5 s, from −1 (no hit) to +1 (3 hits or more); in play the bot sets it to +1 and holds the sights on an enemy. The small point sets it to +2 and stands still to fire.`
const points = D.agents.map((a) => ({ x: a.dist, y: a.kill, text: `${a.label}: distance ${n2(a.dist)}, ${pct(a.kill)} of kills (±${(a.se * 100).toFixed(1)} points), ${pct(a.round)} of rounds` }))
const home = D.agents.findIndex((a) => a.key === 'bc')
chart(svg, $('readout'), {
	H, x0: 0, x1: 1.25, y0: 0, y1: 0.75, R: 8, points, home, xy: true,
	build(c) {
		const ys = [0, 0.25, 0.5, 0.75]
		let s = `<rect x="${c.x(D.control.splits_p05_p95[0]).toFixed(1)}" y="${c.top}" width="${(c.x(D.control.splits_p05_p95[1]) - c.x(D.control.splits_p05_p95[0])).toFixed(1)}" height="${c.H - c.top - c.bottom}" fill="var(--foreground)" opacity="0.06"/>`
		s += P.grid(c, ys, null, 0)
		for (const a of D.agents) s += P.whisker(c, a.dist, a.kill - a.se, a.kill + a.se, 'var(--chart-context)')
		for (const a of D.agents) s += P.dot(c, a.dist, a.kill, col[a.kind], false, a.key === 'oc2' ? 3 : 4)
		s += P.gridLabels(c, ys, (v) => (v === 0.75 ? '75% of kills' : pct(v)))
		s += P.xTicks(c, [
			{ v: 0, label: '0' }, { v: 0.25, label: '0.25' }, { v: 0.5, label: '0.5' },
			{ v: 0.75, label: '0.75', thin: true }, { v: 1.0, label: '1.0' }, { v: 1.25, label: c.thin ? '1.25' : '1.25 from humans' },
		])
		s += P.text(c.x(D.control.splits_p05_p95[1]) + 6, c.top + 22, c.thin ? 'Humans' : 'Human against human')
		s += P.text(c.x(by.bc.dist) + 9, c.y(by.bc.kill) - 7, `${c.thin ? by.bc.short : by.bc.label}: ${n2(by.bc.dist)}, ${pct(by.bc.kill)}`, 'start', 'var(--chart-1)')
		s += P.text(c.thin ? c.x(D.control.splits_p05_p95[1]) + 6 : c.x(by.oc1.dist) - 9, c.y(by.oc1.kill) + (c.thin ? 25 : 16), `${c.thin ? by.oc1.short : by.oc1.label}: ${n2(by.oc1.dist)}, ${pct(by.oc1.kill)}`, c.thin ? 'start' : 'end', 'var(--chart-2)')
		// Narrow: the label goes to the right edge, away from the two learned agents.
		s += P.text(c.thin ? c.x(1.25) : c.x(by.bots3.dist) + 2, c.y(by.bots3.kill) + 18, `${c.thin ? by.bots3.short : by.bots3.label}: ${n2(by.bots3.dist)}, ${pct(by.bots3.kill)}`, 'end')
		s += P.text(c.x(by.bots6.dist) + 2, c.y(by.bots6.kill) - 10, `${c.thin ? by.bots6.short : by.bots6.label}: ${n2(by.bots6.dist)}, ${pct(by.bots6.kill)}`, 'end')
		return s
	},
})
"""

os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
for name, js, data, h, key in (
    ('aim', AIM_JS, aim, 250, ''),
    ('closed', CLOSED_JS, closed, 260, ''),
    ('move', MOVE_JS, move, 250, MOVE_KEY),
    ('trade', TRADE_JS, trade, 260, ''),
):
    html = page(None, js, data, h, key)
    path = os.path.join(HERE, 'out', name + '.html')
    open(path, 'w').write(html)
    print(name, len(html), 'bytes')
print(json.dumps(aim['cap']))
