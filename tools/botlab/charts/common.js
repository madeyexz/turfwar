// Shared hand-drawn chart helper. o: { H, L, R, log, x0, x1, y0, y1, build(c), points:[{x,y,text}], home, xy }
function chart(svg, readout, o) {
	let focus = o.home
	let px = []
	function draw() {
		const w = svg.getBoundingClientRect().width
		if (!w) return
		const thin = w < 500
		const H = o.H
		const top = 14
		const bottom = 24
		const L = o.L || 0
		const R = o.R || 6
		const f = o.log ? Math.log : (v) => v
		const x = (v) => L + ((f(v) - f(o.x0)) / (f(o.x1) - f(o.x0))) * (w - L - R)
		const y = (v) => top + (1 - (v - o.y0) / (o.y1 - o.y0)) * (H - top - bottom)
		let s = o.build({ w, thin, x, y, H, top, bottom })
		const p = o.points[focus]
		if (focus !== o.home) {
			s += `<line x1="${x(p.x)}" x2="${x(p.x)}" y1="${top}" y2="${H - bottom}" stroke="var(--border)"/>`
			s += `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="5" fill="none" stroke="var(--foreground)" stroke-width="1.5"/>`
		}
		svg.setAttribute('viewBox', `0 0 ${w} ${H}`)
		svg.innerHTML = s
		readout.textContent = p.text
		px = o.points.map((q) => [x(q.x), y(q.y)])
	}
	const nearest = (e) => {
		const r = svg.getBoundingClientRect()
		const mx = e.clientX - r.left
		const my = e.clientY - r.top
		let best = 0
		let bd = Infinity
		px.forEach(([a, b], i) => {
			const d = o.xy ? Math.hypot(a - mx, b - my) : Math.abs(a - mx) + Math.abs(b - my) * 0.3
			if (d < bd) {
				bd = d
				best = i
			}
		})
		return best
	}
	const move = (e) => {
		focus = nearest(e)
		draw()
	}
	svg.addEventListener('pointermove', move)
	svg.addEventListener('pointerdown', move)
	svg.addEventListener('pointerleave', (e) => {
		if (e.pointerType === 'touch') return
		focus = o.home
		draw()
	})
	svg.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			focus = o.home
			draw()
			return
		}
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
		e.preventDefault()
		focus = Math.min(o.points.length - 1, Math.max(0, focus + (e.key === 'ArrowRight' ? 1 : -1)))
		draw()
	})
	new ResizeObserver(draw).observe(svg)
	draw()
}
const P = {
	line: (c, pts, color, width, dash) =>
		`<path d="M${pts.map(([a, b]) => `${c.x(a).toFixed(1)},${c.y(b).toFixed(1)}`).join('L')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
	dot: (c, a, b, color, hollow, r) =>
		hollow
			? `<circle cx="${c.x(a).toFixed(1)}" cy="${c.y(b).toFixed(1)}" r="${r || 3}" fill="var(--background)" stroke="${color}" stroke-width="1.5"/>`
			: `<circle cx="${c.x(a).toFixed(1)}" cy="${c.y(b).toFixed(1)}" r="${r || 3}" fill="${color}"/>`,
	text: (px, py, t, anchor, color) =>
		`<text class="halo" x="${px.toFixed(1)}" y="${py.toFixed(1)}"${anchor ? ` text-anchor="${anchor}"` : ''}${color ? ` style="fill:${color}"` : ''}>${t}</text>`,
	whisker: (c, a, lo, hi, color) =>
		`<line x1="${c.x(a).toFixed(1)}" x2="${c.x(a).toFixed(1)}" y1="${c.y(lo).toFixed(1)}" y2="${c.y(hi).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`,
	grid: (c, vals, fmt, baseline) =>
		vals
			.map(
				(v) =>
					`<line x1="0" x2="${c.w}" y1="${c.y(v).toFixed(1)}" y2="${c.y(v).toFixed(1)}" stroke="${v === baseline ? 'var(--border)' : 'var(--grid)'}"/>`,
			)
			.join(''),
	gridLabels: (c, vals, fmt) => vals.map((v) => P.text(0, c.y(v) - 5, fmt(v))).join(''),
	rule: (c, v, from) =>
		`<line x1="${from || 0}" x2="${c.w}" y1="${c.y(v).toFixed(1)}" y2="${c.y(v).toFixed(1)}" stroke="var(--chart-context)" stroke-dasharray="4 3"/>`,
	xTicks: (c, ticks) =>
		ticks
			.filter((t) => !(c.thin && t.thin))
			.map(
				(t, i, all) =>
					`<text x="${c.x(t.v).toFixed(1)}" y="${c.H - 6}" text-anchor="${i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'}">${t.label}</text>`,
			)
			.join(''),
	curve: (f, from, to, n) => {
		const out = []
		for (let i = 0; i <= n; i++) {
			const h = Math.exp(Math.log(from) + (i / n) * (Math.log(to) - Math.log(from)))
			out.push([h, f(h)])
		}
		return out
	},
}
