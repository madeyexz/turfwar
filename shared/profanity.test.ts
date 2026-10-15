import { describe, expect, it } from 'vitest';
import { hasProfanity, maskProfanity } from './profanity';

describe('maskProfanity', () => {
  it('masks English swearing, disguised spellings included, and keeps the rest of the line', () => {
    expect(maskProfanity('what the fuck')).toBe('what the ＊＊＊＊');
    expect(maskProfanity('Shit, nice shot')).toBe('＊＊＊＊, nice shot');
    expect(maskProfanity('you b1tch')).toBe('you ＊＊＊＊＊');
    expect(maskProfanity('fuuuuck')).toBe('＊＊＊＊＊＊＊');
    expect(hasProfanity('f*ck off')).toBe(true);
  });

  it('masks Mandarin and Taiwanese insults, also with separators between the characters', () => {
    expect(maskProfanity('幹你娘 這把')).toBe('＊＊＊ 這把');
    expect(maskProfanity('靠北喔')).toBe('＊＊喔');
    expect(maskProfanity('你這個機掰人')).toBe('你這個＊＊人');
    expect(maskProfanity('操你妈')).toBe('＊＊＊');
    expect(maskProfanity('幹.你.娘')).toBe('＊.＊.＊');
    expect(maskProfanity('幹!')).toBe('＊!');
    expect(maskProfanity('幹 又死了')).toBe('＊ 又死了');
  });

  it('masks English spelled out one letter at a time, keeping the separators', () => {
    expect(maskProfanity('f u c k you')).toBe('＊ ＊ ＊ ＊ you');
    expect(maskProfanity('what the f.u.c.k')).toBe('what the ＊.＊.＊.＊');
    expect(maskProfanity('S-H-1-T')).toBe('＊-＊-＊-＊');
    expect(maskProfanity('$ h ! t!')).toBe('＊ ＊ ＊ ＊!');
    expect(maskProfanity('x y z c u n t')).toBe('x y z ＊ ＊ ＊ ＊');
  });

  it('leaves clean words alone, even ones with a bad word inside', () => {
    for (const ok of ['class', 'assassin', 'Scunthorpe', 'Hancock', 'cocktail', 'cockpit', 'analysis', 'pass the ammo', 'grass',
      // Spelled out, a clean word stays clean: the letters are matched as one word, not as text around them.
      'a s s e m b l y', 'c l a s s', 'p a s s', 'B A S S', 'g g w p', 'A B C site', 'U.S.A', 'a.s.a.p', 'I am a b c', 'e.g. go B',
      '你在幹嘛', '他很能幹', '樹幹後面', '幹部', 'B 點有人', 'gg wp']) expect(maskProfanity(ok)).toBe(ok);
  });

  it('keeps characters outside the basic plane intact next to a masked word', () => {
    expect(maskProfanity('😀 shit 😀')).toBe('😀 ＊＊＊＊ 😀');
  });
});
