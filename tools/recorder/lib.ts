/**
 * What the processor, the recount, the deletion and the export scripts share: reading segments and a
 * subject's input sessions from R2, and the clean-rules classification of one segment.
 */
import type { S3Client } from 'bun';
import { classify, decodeFrames, segmentChecks, type InputSession, type Quality, type SegmentChecks } from '../../shared/rec/clean';
import { In, decodeBatch } from '../../shared/rec/inputlog';
import { decodeSegment, type Segment } from '../../shared/rec/segment';
import { getBytes, listAll } from './r2';

export interface Manifest {
  key: string; bytes: number; rawBytes: number; sha256: string; rawSha256: string;
  recorderSha: string; moduleHash: string; frameVersion: number; mapId: string; mapHash: string;
  mode: string; teamSize: number; roomKind: string; matchUid: string; round: number; startMs: number; endMs: number;
  ticksExpected: number; ticksReceived: number; gapRatio: number; truncated: boolean; pids: string[];
}
/** One processed segment: its checks, a quality record per soldier, and the input batches it used. */
export interface QualityFile { rules: string; segment: string; checks: SegmentChecks; qualities: Quality[]; inputs: string[]; at: number }

export const qualityKey = (manifestKey: string) => manifestKey.replace('/manifest/', '/quality/');
export const manifestKey = (segKey: string) => segKey.replace('/seg/', '/manifest/').replace(/\.tfr\.zst$/, '.json');

export async function loadSegment(c: S3Client, key: string, sha256?: string): Promise<Segment> {
  const zst = await getBytes(c, key);
  if (sha256 && new Bun.CryptoHasher('sha256').update(zst).digest('hex') !== sha256) throw new Error(`checksum mismatch: ${key}`);
  return decodeSegment(new Uint8Array(Bun.zstdDecompressSync(zst)));
}

const DAY = 86_400_000;
/**
 * The input sessions a subject sent from that room and soldier around the segment's time: the index lists
 * their sessions by day; each session's batches are read and joined in order.
 */
export async function inputsFor(c: S3Client, prefix: string, pid: string, seg: Segment, soldierId: number, cache = new Map<string, InputSession[]>()): Promise<{ sessions: InputSession[]; keys: string[] }> {
  const days = new Set([-1, 0, 1].map(d => new Date(seg.header.startMs + d * DAY).toISOString().slice(0, 10)));
  const index = await listAll(c, `${prefix}/index/pid=${pid}/input-`);
  const found: { session: InputSession; keys: string[] }[] = [];
  for (const { key } of index) {
    const m = key.match(/input-(\d{4}-\d{2}-\d{2})-([0-9a-f]{24})\.json$/);
    if (!m || !days.has(m[1])) continue;
    const base = `${prefix}/input/dt=${m[1]}/pid=${pid}/s=${m[2]}/`;
    let batches = cache.get(base);
    const batchKeys = (await listAll(c, base)).map(x => x.key).sort();
    if (!batches) {
      batches = [];
      for (const k of batchKeys) {
        try { batches.push(decodeBatch(new Uint8Array(Bun.gunzipSync(await getBytes(c, k))))); } catch { /* a broken batch is skipped */ }
      }
      cache.set(base, batches);
    }
    const mine = batches.filter(b => b.header.room === seg.header.room && b.header.soldierId === soldierId);
    if (!mine.length) continue;
    mine.sort((a, b) => a.header.seq - b.header.seq);
    found.push({ session: { header: mine[0].header, records: mine.flatMap(b => b.records) }, keys: batchKeys });
  }
  const chosen = ownSessions(found, seg);
  return { sessions: chosen.map(x => x.session), keys: chosen.flatMap(x => x.keys) };
}

/**
 * Soldier ids are reused (they wrap), so the same player may have had this room and id in another
 * match. Keep the sessions that saw this segment's server ticks; when several did (ticks start again in
 * every new room), the ones nearest in time. A client's clock may be off by hours, so time only breaks ties.
 */
function ownSessions<T extends { session: InputSession }>(found: T[], seg: Segment): T[] {
  if (found.length < 2) return found;
  const lo = seg.header.startTick - 30, hi = seg.header.endTick + 30;
  const sees = found.filter(x => x.session.records.some(r => r.type === In.Frame && r.tick >= lo && r.tick <= hi));
  if (sees.length < 2) return sees.length ? sees : found;
  const off = (x: T) => {
    const r = x.session.records, o = x.session.header.timeOrigin;
    const from = o + (r[0]?.t ?? 0), to = o + (r[r.length - 1]?.t ?? 0);
    return to < seg.header.startMs ? seg.header.startMs - to : from > seg.header.endMs ? from - seg.header.endMs : 0;
  };
  const best = Math.min(...sees.map(off));
  return sees.filter(x => off(x) <= best + 3_600_000);
}

/** Classify every soldier of one segment (bots and excluded humans get their tier and no clean seconds). */
export async function qualityOf(c: S3Client, prefix: string, segKey: string, seg: Segment, rules: string, cache?: Map<string, InputSession[]>): Promise<QualityFile> {
  const d = decodeFrames(seg);
  const qualities: Quality[] = [], inputs: string[] = [];
  for (const s of seg.header.soldiers) {
    if (s.bot) continue;
    const found = s.pid && !s.excluded ? await inputsFor(c, prefix, s.pid, seg, s.soldierId, cache) : { sessions: [], keys: [] };
    inputs.push(...found.keys);
    qualities.push(classify(d, s, found.sessions, segKey));
  }
  return { rules, segment: segKey, checks: segmentChecks(d), qualities, inputs: [...new Set(inputs)], at: Date.now() };
}
