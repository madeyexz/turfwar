import { describe, expect, it } from 'vitest';
import { loadMap } from './index';
import { mapsFor } from '../match/rooms';
import { rng } from '../math';
import { TICK_RATE, balanceTeams, createContext, createMatch, tickMatch } from '../match/sim';
import { ELIMINATION, type MatchEvent } from '../match/state';

describe('alley: Back Alley (後巷)', () => {
  it('is offered to 1v1 and 6v6 rooms in Elimination and Sabotage (sites A and B)', () => {
    const { def } = loadMap('alley');
    expect(def.sabotage?.sites).toEqual(['A', 'B']);
    for (const size of [1, 6]) {
      expect(mapsFor(size)).toContain('alley');
      expect(mapsFor(size, 'sabotage')).toContain('alley');
    }
  });

  it('bots fight 6v6 rounds to a result inside the block', () => {
    const events: MatchEvent[] = [];
    const ctx = createContext('alley', rng(7), e => events.push(e));
    const state = createMatch('alley', { ...ELIMINATION, warmup: 0 });
    balanceTeams(state, ctx);
    expect(state.soldiers.length).toBe(12);
    for (let i = 0; i < 240 * TICK_RATE; i++) tickMatch(state, ctx, 1 / TICK_RATE);
    const decided = events.filter(e => e.type === 'round' && e.phase === 'over' && e.winner !== -1);
    expect(decided.length).toBeGreaterThan(1);
    const b = ctx.map.bounds;
    for (const s of state.soldiers) {
      expect(s.m.x).toBeGreaterThan(b.minX); expect(s.m.x).toBeLessThan(b.maxX);
      expect(s.m.z).toBeGreaterThan(b.minZ); expect(s.m.z).toBeLessThan(b.maxZ);
      expect(s.m.y).toBeGreaterThan(-0.5);
    }
  });
});
