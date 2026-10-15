/**
 * The export set (docs/RECORDING.md "Export"): a separate, offline step that reads the internal set and
 * writes a fresh de-identified copy to the turfwar-export bucket, one file per match.
 *
 *   bun tools/recorder/export.ts [--env dev] [--dry-run] [--keep-old]
 *
 * Selection: public rooms only (no private rooms or 1v1 challenges); a match goes whole or not at all —
 * it is left out when any human in any of its rounds was not a recording subject, was in the EU, EEA, UK
 * or Switzerland (or unknown), or has opted out since (opt-out markers). Each file then goes through
 * shared/rec/export.ts (new random ids per file, no names, chat, ids or times, controls as angles and
 * actions) and the checks X1–X3; a file that fails is not written. Dates are Taipei days, or the ISO week
 * when fewer than 5 matches share a day. Each run is a complete snapshot (run=<id>/); older runs are
 * deleted after the new one is complete, so opt-outs leave every later export.
 *
 * Keys: R2_REC_EXPORT_* (reads turfwar-rec, writes turfwar-export).
 */
import type { InputSession } from '../../shared/rec/clean';
import { decodeExport, encodeExport, exportMatch, scanExport } from '../../shared/rec/export';
import { EXPORT_RULES, recPrefix, type RecEnv } from '../../shared/rec/policy';
import type { Segment } from '../../shared/rec/segment';
import { inputsFor, loadSegment, qualityKey, type Manifest, type QualityFile } from './lib';
import { getJson, listAll, putChecked, r2, sha256Hex } from './r2';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const env: RecEnv = arg('--env') === 'dev' ? 'dev' : 'tw';
const dry = process.argv.includes('--dry-run');
const prefix = process.env.REC_PREFIX ?? recPrefix(env);
const src = r2('turfwar-rec', 'R2_REC_EXPORT');
const dst = r2('turfwar-export', 'R2_REC_EXPORT');
const OUT = process.env.REC_PREFIX ? `${process.env.REC_PREFIX}/${EXPORT_RULES}` : env === 'tw' ? EXPORT_RULES : `dev/${EXPORT_RULES}`;
const K = 5;

const taipeiDay = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
function isoWeek(day: string) {
  const d = new Date(`${day}T00:00:00Z`), dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const y = d.getUTCFullYear(), first = new Date(Date.UTC(y, 0, 4));
  const week = 1 + Math.round(((d.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

const optouts = new Set((await listAll(src, `${prefix}/optout/`)).map(x => x.key.match(/pid=([0-9a-f]+)/)?.[1] ?? ''));
const manifests: Manifest[] = [];
for (const { key } of await listAll(src, `${prefix}/manifest/`)) { const m = await getJson<Manifest>(src, key); if (m) manifests.push(m); }
const matches = new Map<string, Manifest[]>();
for (const m of manifests) matches.set(m.matchUid, [...(matches.get(m.matchUid) ?? []), m]);

const why: Record<string, number> = {};
const skip = (r: string) => { why[r] = (why[r] ?? 0) + 1; };
const chosen: { segs: Segment[]; keys: string[]; day: string }[] = [];
for (const [, ms] of matches) {
  if (ms.some(m => m.roomKind !== 'public')) { skip('private room'); continue; }
  if (ms.some(m => m.pids.some(p => optouts.has(p)))) { skip('opted out'); continue; }
  const segs = await Promise.all(ms.map(m => loadSegment(src, m.key, m.sha256)));
  const humans = segs.flatMap(s => s.header.soldiers.filter(x => !x.bot));
  if (segs.some(s => s.header.hasExcluded) || humans.some(h => h.excluded || !h.pid)) { skip('a human not recorded'); continue; }
  if (humans.some(h => h.euUk)) { skip('EU, EEA, UK, CH or unknown'); continue; }
  if (!humans.length) { skip('no humans'); continue; }
  chosen.push({ segs, keys: ms.map(m => m.key), day: taipeiDay(Math.min(...ms.map(m => m.startMs))) });
}
const perDay = new Map<string, number>();
for (const m of chosen) perDay.set(m.day, (perDay.get(m.day) ?? 0) + 1);

const run = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
const files: { key: string; bytes: number; sha256: string; date: string; rounds: number; movementHours: number; aimHours: number }[] = [];
let failedChecks = 0;
for (const m of chosen) {
  const date = (perDay.get(m.day) ?? 0) >= K ? m.day : isoWeek(m.day);
  // Every subject's sessions over the match's rounds (a session spans rounds; keep each once).
  const bySoldier = new Map<number, Map<string, InputSession>>();
  const cache = new Map();
  for (const seg of m.segs) for (const s of seg.header.soldiers) {
    if (s.bot || !s.pid) continue;
    const { sessions } = await inputsFor(src, prefix, s.pid, seg, s.soldierId, cache);
    const own = bySoldier.get(s.soldierId) ?? new Map<string, InputSession>();
    for (const x of sessions) own.set(x.header.session, x);
    bySoldier.set(s.soldierId, own);
  }
  const x = exportMatch(m.segs, [...bySoldier].map(([soldierId, ss]) => ({ soldierId, sessions: [...ss.values()] })), date);
  const bytes = encodeExport(x);
  // X1: the allow-list scan; X2: no internal id of this match survives; X3: it decodes again.
  const secrets = [...new Set(m.segs.flatMap(s => [s.header.matchUid, s.header.recorderSha, s.header.moduleHash, ...s.header.soldiers.flatMap(h => (h.pid ? [h.pid] : []))]))].filter(v => v.length >= 8);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const problems = [...scanExport(decodeExport(bytes)), ...secrets.filter(sv => text.includes(sv)).map(() => 'an internal id')];
  if (problems.length) { failedChecks++; console.error(JSON.stringify({ problems })); continue; }
  const zst = Bun.zstdCompressSync(bytes, { level: 12 });
  const key = `${OUT}/run=${run}/date=${date}/${crypto.randomUUID().replace(/-/g, '')}.tfx.zst`;
  let movementHours = 0, aimHours = 0;
  for (const k of m.keys) {
    const q = await getJson<QualityFile>(src, qualityKey(k.replace('/seg/', '/manifest/').replace(/\.tfr\.zst$/, '.json')));
    for (const r of q?.qualities ?? []) { movementHours += r.clean / 3600; aimHours += r.aimClean / 3600; }
  }
  if (!dry) await putChecked(dst, key, zst, 'application/zstd');
  files.push({ key, bytes: zst.length, sha256: sha256Hex(zst), date, rounds: m.segs.length, movementHours, aimHours });
}
files.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
const summary = {
  rules: EXPORT_RULES, run, createdDay: new Date().toISOString().slice(0, 10), matches: files.length, failedChecks, leftOut: why,
  movementHours: files.reduce((n, f) => n + f.movementHours, 0), aimHours: files.reduce((n, f) => n + f.aimHours, 0),
  files: files.map(({ key, bytes, sha256, date, rounds }) => ({ key, bytes, sha256, date, rounds })),
};
if (!dry) {
  await putChecked(dst, `${OUT}/run=${run}/manifest.json`, JSON.stringify(summary, null, 1), 'application/json');
  if (!process.argv.includes('--keep-old') && !failedChecks) {
    let removed = 0;
    for (const { key } of await listAll(dst, `${OUT}/run=`)) if (!key.startsWith(`${OUT}/run=${run}/`)) { await dst.delete(key); removed++; }
    console.log(JSON.stringify({ oldRunObjectsRemoved: removed }));
  }
}
console.log(JSON.stringify({ ...summary, files: summary.files.length, dry }));
