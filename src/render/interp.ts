/** Snapshot interpolation buffer: samples are rendered `delay` seconds in the past. */
export class InterpBuffer<T extends Record<string, number>> {
  private samples: { t: number; v: T }[] = [];
  push(t: number, v: T) {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) { last.v = v; return; }
    this.samples.push({ t, v });
    if (this.samples.length > 30) this.samples.shift();
  }
  /** Interpolated value at time t; angles listed in `angular` are interpolated the short way. */
  sample(t: number, angular: (keyof T)[] = []): T | undefined {
    const s = this.samples;
    if (!s.length) return undefined;
    if (t <= s[0].t) return s[0].v;
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= t) {
        const a = s[i - 1], b = s[i];
        if (t >= b.t) {
          // Brief extrapolation past the newest sample hides jitter, capped to 100 ms.
          return b.v;
        }
        const k = (t - a.t) / (b.t - a.t);
        const out = {} as Record<string, number>;
        for (const key in b.v) {
          const x = a.v[key], y = b.v[key];
          if (angular.includes(key)) {
            let d = y - x;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            out[key] = x + d * k;
          } else out[key] = x + (y - x) * k;
        }
        return out as T;
      }
    }
    return s[s.length - 1].v;
  }
  latest() { return this.samples[this.samples.length - 1]?.v; }
  clear() { this.samples = []; }
}
