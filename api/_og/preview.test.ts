import { describe, expect, it } from 'vitest';
import { previewImage, previewOf, previewPage, previewText } from './preview';

const at = (path: string) => new URL(path, 'https://turfwar.ianhsiao.me');

describe('link previews', () => {
  it('read challenge and invite links the way the game does', () => {
    expect(previewOf(at('/c?room=ABCD&ch=%E9%98%BF%E7%BF%94&map=taipei&beat=14&ref=k3x9q2ab'))).toEqual({ kind: 'duel', name: '阿翔', map: 'taipei', beat: 14 });
    expect(previewOf(at('/?c=1&ch=Ace&map=nowhere&beat=-3'))).toEqual({ kind: 'duel', name: 'Ace' });
    expect(previewOf(at('/r/kxpb?ref=k3x9q2ab'))).toEqual({ kind: 'invite', room: 'KXPB' });
    expect(previewOf(at('/c?ch=%3C%3E'))).toBeUndefined();
    expect(previewOf(at('/?ch=Ace'))).toBeUndefined();
    expect(previewOf(at('/r/KXPBQ'))).toBeUndefined();
  });

  it('mask bad words in the challenger name, also when the picture reads the name back', () => {
    const p = previewOf(at('/c?ch=shitlord%20%E5%B9%B9%E4%BD%A0%E5%A8%98'))!;
    expect(p).toEqual({ kind: 'duel', name: '＊＊＊＊lord ＊＊＊' });
    expect(previewText(p).title).toBe('＊＊＊＊lord ＊＊＊ 向你發起單挑！《角頭械鬥》');
    // api/og.ts reads the name from the picture's address through previewOf again: the ＊ stay.
    expect(previewOf(new URL(previewImage('https://x.test', p).replace('/api/og?', '/c?')))).toEqual(p);
    expect(previewOf(at('/c?ch=class%20assassin'))).toEqual({ kind: 'duel', name: 'class assassin' });
  });

  it('say who challenges and where', () => {
    expect(previewText({ kind: 'duel', name: '阿翔', map: 'taipei', beat: 14 }).description).toContain('在西門町打出 14 殺');
    expect(previewText({ kind: 'invite', room: 'KXPB' }).description).toContain('私人房 KXPB');
    expect(previewImage('https://x.test', { kind: 'duel', name: '阿翔', map: 'taipei', beat: 0 })).toBe('https://x.test/api/og?k=duel&ch=%E9%98%BF%E7%BF%94&map=taipei&beat=0');
  });

  it('never let a link put markup in the page', () => {
    const url = at('/c?ch=a%22b&x=%22%3E%3Cscript%3E');
    const page = previewPage(url, previewOf(url)!);
    expect(page).not.toContain('<script>');
    expect(page).toContain('og:image" content="https://turfwar.ianhsiao.me/api/og?k=duel&#38;ch=ab"');
  });
});
