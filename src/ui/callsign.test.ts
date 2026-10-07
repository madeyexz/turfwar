import { describe, expect, it } from 'vitest';
import { CALLSIGN_MAX, cleanCallsign, madeUpCallsign } from './callsign';

describe('callsign before the first game', () => {
  it('counts the lobby\'s own names as made up, in both languages', () => {
    for (const n of ['', '   ', 'Player-307', 'player-12', 'PLAYER', 'Player', '玩家', '玩家512', ' Player-999 ']) expect(madeUpCallsign(n)).toBe(true);
  });

  it('takes any name the player typed', () => {
    for (const n of ['Ian', 'Player One', 'Players-1', 'Player-12345', '小明', '玩家小明', 'xX_Sniper_Xx', '0xBEEF']) expect(madeUpCallsign(n)).toBe(false);
  });

  it('cleans what was typed: trimmed, single spaces, at most the field\'s length', () => {
    expect(cleanCallsign('  Ian  ')).toBe('Ian');
    expect(cleanCallsign('Big   Bad\tWolf')).toBe('Big Bad Wolf');
    expect(cleanCallsign('A'.repeat(30))).toHaveLength(CALLSIGN_MAX);
    // Counted in UTF-16 units like the field and the server, but an emoji is never split in half,
    // and no trailing space is left behind.
    expect(cleanCallsign('🐉'.repeat(20))).toBe('🐉'.repeat(CALLSIGN_MAX / 2));
    expect(cleanCallsign('a🐉'.repeat(6))).toBe(`${'a🐉'.repeat(5)}a`);
    expect(cleanCallsign('Fifteen chars x yz')).toBe('Fifteen chars x');
  });
});
