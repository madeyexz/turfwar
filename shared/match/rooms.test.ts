import { describe, expect, it } from 'vitest';
import { PLAYABLE_MAP_IDS, RETIRED_MAPS, loadMap } from '../maps/index';
import { filterError, hasSites, mapsFor, newRoomRules, nextRoomRules, pickRoom, roomMatches, ROOM_SIZES, type RoomFilter, type RoomView } from './rooms';

const room = (r: Partial<RoomView> & { room: number }): RoomView => ({ mapId: 'crane', mode: 'elimination', size: 6, humans: 1, phase: 'live', ...r });
const any = (size = 6): RoomFilter => ({ size, mode: '', map: '' });
/** A seeded random for repeatable picks. */
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

describe('maps per room size', () => {
  it('24v24 plays only big maps; 1v1 and 6v6 every other map; retired maps nowhere', () => {
    const big = PLAYABLE_MAP_IDS.filter(id => loadMap(id).def.big);
    expect(big.length).toBeGreaterThan(0);
    expect(mapsFor(24).sort()).toEqual([...big].sort());
    for (const size of [1, 6]) expect(mapsFor(size).sort()).toEqual(PLAYABLE_MAP_IDS.filter(id => !loadMap(id).def.big).sort());
    for (const s of ROOM_SIZES) for (const id of RETIRED_MAPS) expect(mapsFor(s.perTeam)).not.toContain(id);
    expect(filterError({ size: 6, mode: '', map: 'crane' })).toBeTruthy();
  });

  it('Sabotage lists only maps with bomb sites', () => {
    for (const s of ROOM_SIZES) {
      const sab = mapsFor(s.perTeam, 'sabotage');
      expect(sab.length).toBeGreaterThan(0);
      for (const id of sab) expect(hasSites(id), id).toBe(true);
      expect(mapsFor(s.perTeam, 'elimination')).toEqual(mapsFor(s.perTeam));
    }
  });

  it('validates filters the way the server does', () => {
    expect(filterError({ size: 6, mode: '', map: '' })).toBeUndefined();
    expect(filterError({ size: 24, mode: 'sabotage', map: 'meridian' })).toBeUndefined();
    expect(filterError({ size: 6, mode: 'elimination', map: 'taipei' })).toBeUndefined();
    expect(filterError({ size: 5, mode: '', map: '' })).toBe('Unknown room size');
    expect(filterError({ size: 6, mode: 'domination', map: '' })).toBe('Unknown mode');
    expect(filterError({ size: 6, mode: '', map: 'meridian' })).toBe('That map does not host this room');
    expect(filterError({ size: 24, mode: '', map: 'crane' })).toBe('That map does not host this room');
    expect(filterError({ size: 6, mode: '', map: 'nowhere' })).toBe('That map does not host this room');
    const noSites = mapsFor(6).find(id => !hasSites(id))!;
    expect(filterError({ size: 6, mode: 'sabotage', map: noSites })).toBe('That map does not host this room');
  });
});

describe('Play Online matchmaking', () => {
  it('Any picks the fullest open room of the size, as Quick Play always has', () => {
    const rooms = [room({ room: 0, humans: 3 }), room({ room: 1, humans: 7, mapId: 'tower' }), room({ room: 2, humans: 9, size: 24, mapId: 'meridian' })];
    expect(pickRoom(rooms, any())?.room).toBe(1);
    expect(pickRoom(rooms, any(24))?.room).toBe(2);
    expect(pickRoom(rooms, any(1))).toBeUndefined();
  });

  it('skips full rooms and breaks ties by the lowest id', () => {
    const rooms = [room({ room: 4, humans: 12 }), room({ room: 3, humans: 2 }), room({ room: 1, humans: 2 })];
    expect(pickRoom(rooms, any())?.room).toBe(1);
  });

  it('a specific map or mode only matches rooms playing it now', () => {
    const rooms = [room({ room: 0, mapId: 'taipei', mode: 'sabotage', humans: 5 }), room({ room: 1, mapId: 'crane', mode: 'elimination', humans: 9 }), room({ room: 2, mapId: 'tower', mode: 'elimination', humans: 2 })];
    expect(pickRoom(rooms, { size: 6, mode: '', map: 'taipei' })?.room).toBe(0);
    expect(pickRoom(rooms, { size: 6, mode: 'sabotage', map: '' })?.room).toBe(0);
    expect(pickRoom(rooms, { size: 6, mode: 'elimination', map: '' })?.room).toBe(1);
    expect(pickRoom(rooms, { size: 6, mode: 'sabotage', map: 'crane' })).toBeUndefined();
    expect(pickRoom(rooms, { size: 6, mode: '', map: 'courtyard' })).toBeUndefined();
    expect(pickRoom(rooms, { size: 24, mode: '', map: 'taipei' })).toBeUndefined();
  });

  it('Any joins a room opened for a specific map', () => {
    const fixed = room({ room: 5, mapId: 'taipei', fixedMap: true, humans: 1 });
    expect(pickRoom([fixed], any())?.room).toBe(5);
    expect(roomMatches(fixed, { size: 6, mode: 'elimination', map: '' })).toBe(true);
  });

  it('a rotating room on its end screen no longer counts for its map or mode', () => {
    const leaving = room({ room: 0, mapId: 'taipei', mode: 'sabotage', phase: 'ended', humans: 8 });
    expect(roomMatches(leaving, any())).toBe(true);
    expect(roomMatches(leaving, { size: 6, mode: '', map: 'taipei' })).toBe(false);
    expect(roomMatches(leaving, { size: 6, mode: 'sabotage', map: '' })).toBe(false);
    expect(roomMatches({ ...leaving, fixedMap: true }, { size: 6, mode: '', map: 'taipei' })).toBe(true);
    expect(roomMatches({ ...leaving, fixedMap: true }, { size: 6, mode: 'sabotage', map: 'taipei' })).toBe(false);
    expect(roomMatches({ ...leaving, fixedMap: true, fixedMode: true }, { size: 6, mode: 'sabotage', map: 'taipei' })).toBe(true);
  });

  it('prefers a room that keeps the asked-for map when rooms are equally full', () => {
    const rooms = [room({ room: 0, mapId: 'taipei', humans: 3 }), room({ room: 1, mapId: 'taipei', humans: 3, fixedMap: true })];
    expect(pickRoom(rooms, { size: 6, mode: '', map: 'taipei' })?.room).toBe(1);
    expect(pickRoom(rooms, any())?.room).toBe(0);
  });
});

describe('new rooms and rotation', () => {
  it('opens a new room with the asked-for rules, fixed; Any picks a valid map and mode', () => {
    expect(newRoomRules({ size: 6, mode: 'sabotage', map: 'taipei' }, Math.random)).toEqual({ mapId: 'taipei', mode: 'sabotage', fixedMap: true, fixedMode: true });
    const random = seeded(7);
    for (let i = 0; i < 200; i++) {
      for (const s of ROOM_SIZES) {
        const a = newRoomRules(any(s.perTeam), random);
        expect(mapsFor(s.perTeam)).toContain(a.mapId);
        expect(a.fixedMap || a.fixedMode).toBe(false);
        if (a.mode === 'sabotage') expect(hasSites(a.mapId)).toBe(true);
        const sab = newRoomRules({ size: s.perTeam, mode: 'sabotage', map: '' }, random);
        expect(hasSites(sab.mapId)).toBe(true);
        expect(sab).toMatchObject({ mode: 'sabotage', fixedMap: false, fixedMode: true });
      }
    }
    const modes = new Set(Array.from({ length: 100 }, () => newRoomRules({ size: 6, mode: '', map: 'taipei' }, random).mode));
    expect([...modes].sort()).toEqual(['elimination', 'sabotage']);
  });

  it('Any rooms rotate maps and alternate modes, as before', () => {
    const maps = mapsFor(6);
    const next = nextRoomRules(maps[0], 'sabotage', 6);
    expect(next).toEqual({ mapId: maps[1], mode: 'elimination' });
    const last = nextRoomRules(maps[maps.length - 1], 'elimination', 6);
    expect(last.mapId).toBe(maps[0]);
    expect(last.mode).toBe(hasSites(maps[0]) ? 'sabotage' : 'elimination');
  });

  it('a fixed map stays and its mode alternates where it has bomb sites', () => {
    expect(nextRoomRules('taipei', 'sabotage', 6, { fixedMap: true })).toEqual({ mapId: 'taipei', mode: 'elimination' });
    expect(nextRoomRules('taipei', 'elimination', 6, { fixedMap: true })).toEqual({ mapId: 'taipei', mode: 'sabotage' });
    const noSites = mapsFor(6).find(id => !hasSites(id))!;
    expect(nextRoomRules(noSites, 'elimination', 6, { fixedMap: true })).toEqual({ mapId: noSites, mode: 'elimination' });
  });

  it('a fixed mode stays and the map rotates among maps that host it', () => {
    let at = mapsFor(6, 'sabotage')[0];
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const n = nextRoomRules(at, 'sabotage', 6, { fixedMode: true });
      expect(n.mode).toBe('sabotage');
      expect(hasSites(n.mapId)).toBe(true);
      seen.add(n.mapId); at = n.mapId;
    }
    expect(seen.size).toBe(mapsFor(6, 'sabotage').length);
    expect(nextRoomRules('meridian', 'elimination', 24, { fixedMode: true }).mode).toBe('elimination');
  });

  it('a fixed map and mode replay', () => {
    expect(nextRoomRules('crane', 'sabotage', 6, { fixedMap: true, fixedMode: true })).toEqual({ mapId: 'crane', mode: 'sabotage' });
  });
});
