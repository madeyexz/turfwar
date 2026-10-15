/**
 * Bias check of the clean set (docs/RECORDING.md "Bias"): how the movement-clean and aim-clean hours split
 * by device, input, map, mode, room size, Taipei hour of day and player, next to all hours of recorded
 * play, so a rule that drops one kind of player more than others shows up.
 *
 *   bun scripts/rec-bias.ts [--env dev]
 *
 * Reads the quality files with R2_REC_READ_* keys.
 */
import type { Quality } from '../shared/rec/clean';
import { recPrefix, type RecEnv } from '../shared/rec/policy';
import type { QualityFile } from '../tools/recorder/lib';
import { getJson, listAll, r2 } from '../tools/recorder/r2';

const env: RecEnv = process.argv.includes('dev') ? 'dev' : 'tw';
const prefix = process.env.REC_PREFIX ?? recPrefix(env);
const c = r2('turfwar-rec', 'R2_REC_READ');
const qs: Quality[] = [];
for (const { key } of await listAll(c, `${prefix}/quality/`)) { const f = await getJson<QualityFile>(c, key); if (f) qs.push(...f.qualities.filter(q => q.tier !== 'bot' && q.tier !== 'excluded')); }

const hourOf = (q: Quality) => String((new Date(q.startMs).getUTCHours() + 8) % 24).padStart(2, '0');
const dims: Record<string, (q: Quality) => string> = {
  device: q => q.device || 'unknown', input: q => `${q.input}${q.aimAssist ? '+assist' : ''}`, map: q => q.map, mode: q => q.mode,
  size: q => `${q.teamSize}v${q.teamSize}`, room: q => q.roomKind, taipeiHour: hourOf,
};
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const sum = (xs: Quality[], f: (q: Quality) => number) => xs.reduce((n, q) => n + f(q), 0) / 3600;
const all = sum(qs, q => q.aliveLive), mov = sum(qs, q => q.clean), aim = sum(qs, q => q.aimClean);
console.log(`subject rounds ${qs.length}; played ${all.toFixed(2)} h; movement-clean ${mov.toFixed(2)} h (${pct(mov, all)}); aim-clean ${aim.toFixed(2)} h (${pct(aim, all)})`);
for (const [name, f] of Object.entries(dims)) {
  const groups = new Map<string, Quality[]>();
  for (const q of qs) { const k = f(q); groups.set(k, [...(groups.get(k) ?? []), q]); }
  console.log(`\n${name.padEnd(12)} ${'played'.padStart(8)} ${'share'.padStart(7)} ${'move'.padStart(7)} ${'aim'.padStart(7)} ${'kept'.padStart(7)}`);
  for (const [k, g] of [...groups].sort((a, b) => sum(b[1], q => q.aliveLive) - sum(a[1], q => q.aliveLive))) {
    const p = sum(g, q => q.aliveLive), m = sum(g, q => q.clean), a = sum(g, q => q.aimClean);
    console.log(`${k.slice(0, 12).padEnd(12)} ${p.toFixed(2).padStart(8)} ${pct(p, all).padStart(7)} ${pct(m, mov).padStart(7)} ${pct(a, aim).padStart(7)} ${pct(m, p).padStart(7)}`);
  }
}
const byPid = new Map<string, number>();
for (const q of qs) byPid.set(q.pid, (byPid.get(q.pid) ?? 0) + q.clean);
const v = [...byPid.values()].sort((a, b) => b - a), total = v.reduce((a, b) => a + b, 0);
console.log(`\nplayers ${v.length}; top 10 % hold ${pct(v.slice(0, Math.max(1, Math.ceil(v.length / 10))).reduce((a, b) => a + b, 0), total)} of movement-clean time; top player ${pct(v[0] ?? 0, total)}`);
