import { describe, expect, it } from 'vitest';
import { rng } from '../math';
import { decodeFrame, encodeFrame } from '../match/frame';
import { ELIMINATION, type MatchEvent } from '../match/state';
import { balanceTeams, createContext, createMatch, resetMatch, tickMatch, TICK_RATE } from '../match/sim';
import { classify, decodeFrames, segmentChecks, totals, type InputSession } from './clean';
import { Ex, decodeExport, encodeExport, exportMatch, scanExport } from './export';
import { In, InputWriter, decodeBatch, encodeBatch, type InputHeader } from './inputlog';
import { leftOutCountry, leftOutZone, pidOf } from './policy';
import { Segmenter } from './segmenter';
import { Rec, decodeSegment, encodeSegment, jsonRecord, recordJson, zeroSoldiers, type Segment, type SegmentRecord } from './segment';

/** A recorded round from the real simulation: bots playing Elimination on Cinder for `seconds` of live time. */
function recordRound(seconds: number) {
  const events: { tick: number; e: MatchEvent }[] = [];
  const state = createMatch('cinder', { ...ELIMINATION, teamSize: 6, warmup: 0 });
  const ctx = createContext('cinder', rng(7), e => events.push({ tick: state.tick, e }));
  balanceTeams(state, ctx);
  resetMatch(state, ctx);
  for (let i = 0; i < Math.round((state.config.freezeTime + 0.1) * TICK_RATE); i++) tickMatch(state, ctx, 1 / TICK_RATE);
  const records: SegmentRecord[] = [];
  const startTick = state.tick;
  for (let i = 0; i < seconds * TICK_RATE && state.roundPhase === 'live'; i++) {
    tickMatch(state, ctx, 1 / TICK_RATE);
    records.push({ type: Rec.Frame, tick: state.tick, ms: 1e12 + state.tick * 1000 / 30, data: encodeFrame(state, []) });
  }
  for (const { tick, e } of events) if (e.type === 'kill' || e.type === 'chat' || e.type === 'join') records.push(jsonRecord(Rec.Event, tick, 0, e));
  records.push(jsonRecord(Rec.Event, state.tick, 0, { type: 'chat', id: state.soldiers[0].id, name: 'Callsign', team: 0, text: 'hi', teamOnly: false }));
  for (const s of state.soldiers) records.push(jsonRecord(Rec.Roster, startTick, 0, { id: s.id, name: s.name, team: s.team, corrections: 0 }));
  const seg: Segment = {
    header: {
      recFormat: 1, frameVersion: 6, env: 'dev', recorderSha: 'abc', moduleHash: 'f'.repeat(64), mapId: 'cinder', mapHash: 'h', configJson: '{}',
      mode: 'elimination', teamSize: 6, room: 3, roomKind: 'public', matchUid: 'm1', round: state.round,
      startTick, endTick: state.tick, startMs: 1e12, endMs: 1e12 + (state.tick - startTick) * 1000 / 30,
      ticksExpected: state.tick - startTick, ticksReceived: state.tick - startTick, gapRatio: 0, ticksPerSecond: 30, truncated: false, hasExcluded: false,
      soldiers: state.soldiers.map(s => ({ soldierId: s.id, team: s.team, bot: true, from: startTick, to: state.tick })),
    },
    records,
  };
  return { seg, state };
}

/**
 * A human-like input log for `id` that agrees with the server: each frame arrives 10 ms after its tick.
 * `clock` gives the server's time of each tick (ms); by default a steady 30 Hz.
 */
function inputsFor(seg: Segment, id: number, over: Partial<InputHeader> = {}, clock = (tick: number) => tick * 1000 / 30): InputSession {
  const d = decodeFrames(seg);
  const w = new InputWriter(0);
  for (const f of d.frames) {
    const p = f.poses.find(q => q.id === id)!;
    const t = clock(f.tick) + 10;
    w.move(t - 5, 3, -1, true);
    w.rtt(t - 2, 60);
    w.frame(t, { lookX: 3, lookY: -1, scale: 0.002, assistYaw: 0, assistPitch: 0, assistScale: 1, yaw: p.yaw, pitch: p.pitch, alive: p.alive, tick: f.tick, tickAgeMs: 10 });
  }
  const header: InputHeader = {
    recFormat: 1, session: 's1', seq: 0, build: 'b', db: 'lawbreaker-dev', room: seg.header.room, soldierId: id, device: 'desktop', platform: 'web',
    touch: false, assist: false, sens: 0.002, fov: 75, unadjusted: false, dpr: 2, refreshHz: 0, coalesced: true, keys: ['other', 'KeyW'], actions: ['', 'forward'],
    timeOrigin: 1e12, t0: 0, ...over,
  };
  return decodeBatch(encodeBatch(header, w.take().bytes));
}

describe('recording formats', () => {
  it('segments and input batches round-trip', () => {
    const { seg } = recordRound(3);
    const back = decodeSegment(encodeSegment(seg));
    expect(back.header).toEqual(seg.header);
    expect(back.records.length).toBe(seg.records.length);
    expect([...back.records[5].data]).toEqual([...seg.records[5].data]);

    const w = new InputWriter(100);
    w.move(100.5, -7, 300, true); w.key(101, 1, true); w.touch(102, 3, 1, 0.25, 1); w.send(103, 1, 9); w.rtt(104, 88.5); w.sens(105, 0.0031);
    const batch = w.take();
    const { header, records } = decodeBatch(encodeBatch({ ...inputsFor(seg, 1).header, t0: batch.t0 }, batch.bytes));
    expect(header.soldierId).toBe(1);
    expect(records.map(r => r.type)).toEqual([In.Move, In.Key, In.Touch, In.Send, In.Rtt, In.Sens]);
    expect(records[0]).toMatchObject({ dx: -7, dy: 300, coalesced: true });
    expect(records[0].t).toBeCloseTo(100.5, 3);
    expect(records[2]).toMatchObject({ id: 3, phase: 1, y: 1 });
    expect((records[2] as { x: number }).x).toBeCloseTo(0.25, 4);
    expect(records[5].t).toBeCloseTo(105, 3);
  });

  it('zeroSoldiers blanks one soldier and nobody else', () => {
    const { seg, state } = recordRound(1);
    const frame = seg.records.find(r => r.type === Rec.Frame)!.data;
    const gone = state.soldiers[2].id, kept = state.soldiers[3].id;
    const before = decodeFrame(frame)!, after = decodeFrame(zeroSoldiers(frame, new Set([gone])))!;
    const g = after.poses.find(p => p.id === gone)!;
    expect(g.alive).toBe(false);
    expect([g.x, g.z, g.health]).toEqual([0, 0, 0]);
    expect(after.poses.find(p => p.id === kept)).toEqual(before.poses.find(p => p.id === kept));
  });

  it('pids depend on the salt and the environment, and the left-out regions include unknown', async () => {
    const a = await pidOf('salt-1', 'tw', 'c200aa'), b = await pidOf('salt-2', 'tw', 'c200aa'), c = await pidOf('salt-1', 'dev', 'c200aa');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(await pidOf('salt-1\n', 'tw', 'c200aa')).toBe(a);
    expect([leftOutCountry('DE'), leftOutCountry('CH'), leftOutCountry('GB'), leftOutCountry('TW'), leftOutCountry(undefined), leftOutCountry('XX')]).toEqual([true, true, true, false, true, true]);
    expect([leftOutZone('Europe/Berlin'), leftOutZone('Asia/Taipei'), leftOutZone('')]).toEqual([true, false, true]);
  });
});

describe('clean rules', () => {
  it('counts movement-clean for touch with assist, and aim-clean only without it', () => {
    const { seg } = recordRound(20);
    const d = decodeFrames(seg);
    const id = seg.header.soldiers[0].soldierId;
    const human = { ...seg.header.soldiers[0], bot: false, pid: 'p1', device: 'desktop' };
    const mouse = classify(d, human, [inputsFor(seg, id)], 'k');
    expect(mouse.tier).toBe('clean');
    expect(mouse.checks.inputCoverage).toBeGreaterThan(0.95);
    expect(mouse.checks.aimErrorDeg).toBeLessThan(0.5);
    expect(mouse.clean).toBeGreaterThan(1);
    expect(mouse.aimClean).toBe(mouse.clean);
    expect(mouse.input).toBe('mouse');

    const phone = classify(d, { ...human, device: 'phone' }, [inputsFor(seg, id, { touch: true, assist: true, device: 'phone' })], 'k');
    expect([phone.input, phone.aimAssist, phone.device]).toEqual(['touch', true, 'phone']);
    expect(phone.clean).toBeCloseTo(mouse.clean, 5);
    expect(phone.aimClean).toBe(0);
    expect(phone.dropped.E7aim).toBeCloseTo(phone.clean, 5);

    const t = totals([mouse, phone, { ...mouse, roomKind: 'private' }]);
    expect(t.movementHours).toBeCloseTo(3 * mouse.clean / 3600, 9);
    expect(t.aimHours).toBeCloseTo(2 * mouse.clean / 3600, 9);
    expect(t.exportMovementHours).toBeCloseTo(2 * mouse.clean / 3600, 9);
    expect(t.byInput.touch).toBeCloseTo(phone.clean / 3600, 9);
  });

  it('follows a server whose tick rate drifts (27–31 Hz, a dip to 20 Hz), and a second page load\'s own clock', () => {
    const { seg } = recordRound(40);
    const d = decodeFrames(seg);
    const id = seg.header.soldiers[0].soldierId;
    const human = { ...seg.header.soldiers[0], bot: false, pid: 'p1', device: 'desktop' };
    // Tick length (ms) wanders around 33.3 and stretches to 50 (20 Hz) for a few seconds: a straight line strays by many ticks.
    const start = seg.header.startTick, at: number[] = [];
    for (let k = 0, t = 0; k <= seg.header.endTick - start + 1; k++) { at.push(t); const s = k / 30; t += s > 15 && s < 22 ? 50 : 1000 / (29 + 2 * Math.sin(s / 3)); }
    const drifting = inputsFor(seg, id, {}, tick => 5e5 + at[tick - start]);
    const q = classify(d, human, [drifting], 'k');
    expect(q.checks.clockResidual).toBeLessThan(1);
    expect(q.checks.aimErrorDeg).toBeLessThan(0.5);
    expect(q.dropped).not.toHaveProperty('E9');
    expect(q.clean).toBeGreaterThan(20);
    // The same log split over two page loads, each counting from its own timeOrigin.
    const half = Math.floor(drifting.records.length / 2), mid = drifting.records[half].t;
    const later = { header: { ...drifting.header, session: 's2', timeOrigin: drifting.header.timeOrigin + mid }, records: drifting.records.slice(half).map(r => ({ ...r, t: r.t - mid })) };
    const split = classify(d, human, [{ ...drifting, records: drifting.records.slice(0, half) }, later], 'k');
    expect(split.clean).toBeCloseTo(q.clean, 5);
    expect(split.checks.aimErrorDeg).toBeLessThan(0.5);
  });

  it('drops a round with a bad round trip, a bad aim match, or no input log', () => {
    const { seg } = recordRound(20);
    const d = decodeFrames(seg);
    const id = seg.header.soldiers[0].soldierId;
    const human = { ...seg.header.soldiers[0], bot: false, pid: 'p1' };
    const slow = inputsFor(seg, id);
    slow.records = slow.records.map(r => (r.type === In.Rtt ? { ...r, ms: 400 } : r));
    expect(classify(d, human, [slow], 'k')).toMatchObject({ clean: 0, aimClean: 0 });
    const lying = inputsFor(seg, id);
    lying.records = lying.records.map(r => (r.type === In.Frame ? { ...r, yaw: r.yaw + 0.3 } : r));
    expect(classify(d, human, [lying], 'k').dropped).toHaveProperty('E9');
    expect(classify(d, human, [], 'k')).toMatchObject({ tier: 'server-only', clean: 0 });
    expect(classify(d, { ...human, excluded: true, pid: undefined }, [inputsFor(seg, id)], 'k').tier).toBe('excluded');
  });

  it('every kill event matches a death in the frames', () => {
    const { seg } = recordRound(40);
    const c = segmentChecks(decodeFrames(seg));
    expect(c.kills).toBeGreaterThan(0);
    expect(c.killsMatched).toBe(c.kills);
  });
});

describe('export', () => {
  it('replaces every id, keeps the play, and drops chat, names and times', () => {
    const { seg, state } = recordRound(20);
    const id = seg.header.soldiers[0].soldierId;
    seg.header.soldiers[0] = { ...seg.header.soldiers[0], bot: false, pid: 'p1', device: 'phone' };
    const x = exportMatch([seg], [{ soldierId: id, sessions: [inputsFor(seg, id, { touch: true, assist: true, device: 'phone' })] }], '2026-10-16');
    const file = decodeExport(encodeExport(x));
    expect(scanExport(file, new Set(state.soldiers.map(s => s.name)))).toEqual([]);
    const ids = file.header.soldiers.map(s => s.id);
    expect(new Set(ids).size).toBe(state.soldiers.length);
    const sub = file.header.soldiers.find(s => s.hasInput)!;
    expect(sub).toMatchObject({ device: 'phone', input: 'touch', aimAssist: true });

    // Same play: the frames decode to the same positions under the new ids, with ticks from 0.
    const map = new Map<number, number>();
    const firstIn = decodeFrame(seg.records.find(r => r.type === Rec.Frame)!.data)!;
    const firstOut = decodeFrame(file.records.find(r => r.type === Ex.Frame)!.data)!;
    expect(firstOut.tick).toBe(firstIn.tick - seg.header.startTick);
    firstIn.poses.forEach((p, i) => map.set(p.id, firstOut.poses[i].id));
    firstIn.poses.forEach((p, i) => expect({ ...firstOut.poses[i], id: 0 }).toEqual({ ...p, id: 0 }));
    expect([...map.values()].every(v => ids.includes(v))).toBe(true);
    expect([...map].some(([a, b]) => a !== b)).toBe(true);

    // Kills name the new ids; no chat survives.
    const dec = new TextDecoder();
    const events = file.records.filter(r => r.type === Ex.Event).map(r => JSON.parse(dec.decode(r.data)));
    expect(events.some(e => e.type === 'chat')).toBe(false);
    const kills = seg.records.filter(r => r.type === Rec.Event).map(r => recordJson<MatchEvent>(r)).filter(e => e.type === 'kill');
    const outKills = events.filter(e => e.type === 'kill');
    expect(outKills.length).toBe(kills.length);
    kills.forEach((k, i) => k.type === 'kill' && expect(outKills[i].victim).toBe(map.get(k.victim)));

    // The controls are there, in radians, under the subject's new id.
    const input = file.records.find(r => r.type === Ex.Input)!;
    expect(new DataView(input.data.buffer, input.data.byteOffset).getUint16(0, true)).toBe(sub.id);
    const rows = new Float32Array(input.data.slice(2).buffer);
    expect(rows[0]).toBe(2); // Move first
    expect(rows[2]).toBeCloseTo(-3 * 0.002, 6);

    // A second export of the same match has different ids (no linking across files).
    const again = exportMatch([seg], [], '2026-10-16');
    expect(again.header.soldiers.map(s => s.id)).not.toEqual(ids);
  });
});

describe('segmenter', () => {
  it('cuts rounds, blanks humans who are not subjects, and keeps no chat or callsign', () => {
    const { seg, state } = recordRound(3);
    const frames = seg.records.filter(r => r.type === Rec.Frame);
    const [subjectId, otherId] = [state.soldiers[0].id, state.soldiers[1].id];
    const closed: Segment[] = [];
    let uid = 0, now = 0;
    const s = new Segmenter({ env: 'dev', recorderSha: 'x', moduleHash: () => 'm', mapHash: () => 'h', now: () => now, uid: () => `u${++uid}`, onClose: x => closed.push(x) });
    const roster = (id: number) => { const x = state.soldiers.find(q => q.id === id)!; return { id, team: x.team, bot: id !== subjectId && id !== otherId, name: x.name, kills: 0 }; };
    const subject = (id: number) => (id === subjectId ? { pid: 'p1', subject: true, device: 'phone', euUk: false, termsVersion: 1 } : { subject: false, device: '', euUk: false, termsVersion: 0 });
    const info = { configJson: '{}', mode: 'elimination', teamSize: 6, private: false };
    // Round 1: the frames; round 2: the same frames with the round number bumped and later ticks; a dropped tick in between.
    frames.forEach((f, i) => { now = i; s.frame(3, 'cinder', f.data, info, roster, subject); if (i === 5) { s.event(3, JSON.stringify({ type: 'chat', id: subjectId, name: 'N', text: 'hi' })); s.event(3, JSON.stringify({ type: 'join', id: otherId, name: 'Callsign', team: 1 })); } });
    const later = frames.map(f => { const b = f.data.slice(), v = new DataView(b.buffer); v.setUint16(14, v.getUint16(14, true) + 1, true); v.setUint32(1, v.getUint32(1, true) + 1000, true); return b; });
    later.forEach((b, i) => { if (i !== 3) s.frame(3, 'cinder', b, info, roster, subject); });
    // A room with no subject leaves nothing.
    frames.slice(0, 5).forEach(f => s.frame(4, 'cinder', f.data, info, roster, () => undefined));
    s.closeAll(true);

    expect(closed.length).toBe(2);
    expect(s.droppedNoSubject).toBe(1);
    const [a, b] = closed;
    expect(a.header.matchUid).toBe(b.header.matchUid);
    expect(b.header.round).toBe(a.header.round + 1);
    expect(a.header.truncated).toBe(false);
    expect(b.header.truncated).toBe(true);
    expect(b.header.ticksReceived).toBe(b.header.ticksExpected - 1);
    expect(b.records.some(r => r.type === Rec.Gap)).toBe(true);
    const sub = a.header.soldiers.find(x => x.soldierId === subjectId)!, other = a.header.soldiers.find(x => x.soldierId === otherId)!;
    expect(sub).toMatchObject({ pid: 'p1', device: 'phone' });
    expect(other.excluded).toBe(true);
    expect(other.pid).toBeUndefined();
    expect(a.header.hasExcluded).toBe(true);
    const f0 = decodeFrame(a.records.find(r => r.type === Rec.Frame)!.data)!;
    expect(f0.poses.find(p => p.id === otherId)).toMatchObject({ x: 0, z: 0, alive: false });
    expect(f0.poses.find(p => p.id === subjectId)!.alive).toBe(true);
    const text = new TextDecoder().decode(encodeSegment(a));
    expect(text).not.toContain('hi"');
    expect(text).not.toContain('Callsign');
    for (const x of state.soldiers) expect(text).not.toContain(`"${x.name}"`);
    expect(a.records.filter(r => r.type === Rec.Event).map(r => recordJson<{ type: string }>(r).type)).toEqual(['join']);
  });

  it('blanks a human the server has not described yet without leaving them out of the round', () => {
    const { seg, state } = recordRound(2);
    const frames = seg.records.filter(r => r.type === Rec.Frame);
    const id = state.soldiers[0].id;
    const closed: Segment[] = [];
    let n = 0;
    const s = new Segmenter({ env: 'dev', recorderSha: 'x', moduleHash: () => 'm', mapHash: () => 'h', now: () => n, uid: () => 'u', onClose: x => closed.push(x) });
    const roster = (q: number) => ({ id: q, team: 0, bot: q !== id });
    const info = { configJson: '{}', mode: 'elimination', teamSize: 6, private: false };
    frames.forEach((f, i) => { n = i; s.frame(1, 'cinder', f.data, info, roster, q => (q === id && i >= 10 ? { pid: 'p', subject: true, device: 'desktop', euUk: false, termsVersion: 1 } : undefined)); });
    s.closeAll(false);
    const h = closed[0].header.soldiers.find(x => x.soldierId === id)!;
    expect(h).toMatchObject({ pid: 'p' });
    expect(h.excluded).toBeUndefined();
    expect(closed[0].header.hasExcluded).toBe(false);
    const at = (i: number) => decodeFrame(closed[0].records.filter(r => r.type === Rec.Frame)[i].data)!.poses.find(p => p.id === id)!;
    expect(at(5)).toMatchObject({ x: 0, z: 0, alive: false });
    expect(at(20).alive).toBe(true);
  });
});
