import { describe, expect, it } from 'vitest';
import { foldName, nameWords, offensiveName } from './names';

describe('callsign filter', () => {
  it('catches slurs and abuse, spaced out, stretched or in look-alike characters', () => {
    for (const n of ['nigger', 'N1gg3r', 'n i g g e r', 'niiigger', 'F.A.G.G.O.T', 'xXfuckXx', 'KillYourself', 'shit_happens', 'Dick', 'xXShitXx', 's h i t', '幹你娘', '靠北', '雞掰人', '支那豬']) {
      expect(offensiveName(n), n).toBe(true);
    }
  });

  it('leaves ordinary callsigns alone, including names that merely contain a short word', () => {
    for (const n of ['Raven', 'Ah-Kuan', '阿寬', 'Player-123', '玩家766', 'Assassin', 'Scunthorpe', 'Dickens', 'Cockpit', 'Spice', 'Pakistan', 'Shitake', 'Raccoon', 'Grape', 'Nazir']) {
      expect(offensiveName(n), n).toBe(false);
    }
    expect(offensiveName('')).toBe(false);
  });

  it('folds and splits names', () => {
    expect(foldName('R4v3n!')).toBe('raveni');
    expect(foldName('阿 寬')).toBe('阿寬');
    expect(nameWords('xXShitXx')).toEqual(['x', 'x', 'shit', 'xx']);
  });
});
