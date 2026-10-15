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

  it('leaves clean words alone, even ones with a bad word inside', () => {
    for (const ok of ['class', 'assassin', 'Scunthorpe', 'Hancock', 'cocktail', 'analysis', 'pass the ammo', 'grass',
      '你在幹嘛', '他很能幹', '樹幹後面', '幹部', 'B 點有人', 'gg wp']) expect(maskProfanity(ok)).toBe(ok);
  });

  it('keeps characters outside the basic plane intact next to a masked word', () => {
    expect(maskProfanity('😀 shit 😀')).toBe('😀 ＊＊＊＊ 😀');
  });
});
