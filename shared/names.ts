/**
 * Callsigns other players see (score bar, kill feed, chat): slurs and abuse are refused. The server
 * replaces such a name when the player joins (spacetimedb enterRoom); the lobby asks for another one.
 * Matching folds the name first (lower case, look-alike digits and symbols read as letters), so
 * "N1gg3r" and "n i g g e r" are caught. Long, unmistakable slurs match anywhere in the name; short
 * words match only as a whole word (so "Dickens", "Cockpit" and "Scunthorpe" stay fine).
 */

const ANYWHERE = ['nigger', 'nigga', 'faggot', 'motherfucker', 'fuck', 'killyourself', 'heilhitler', 'raghead', 'towelhead', 'wetback'];
const WORDS = [
  'retard', 'chink', 'kike', 'spic', 'coon', 'gook', 'paki', 'cunt', 'whore', 'rapist', 'rape', 'hitler', 'nazi', 'kkk', 'fag', 'tranny',
  'beaner', 'shit', 'bitch', 'dick', 'cock', 'pussy', 'slut', 'porn', 'kys', 'fuk', 'fck',
];
/** Chinese abuse, written as escapes: these are only matched, never drawn (src/ui/font.test.ts checks drawn text). */
const ZH = [
  '\u5e79\u4f60', '\u5e79\u59b3', '\u64cd\u4f60', '\u808f', '\u9760\u5317', '\u9760\u676f', '\u4ed6\u5abd',
  '\u4ed6\u5988', '\u4f60\u5abd', '\u4f60\u5988', '\u5abd\u7684', '\u5988\u7684', '\u6a5f\u63b0', '\u96de\u63b0',
  '\u6a5f\u516b', '\u96de\u5df4', '\u9e21\u5df4', '\u5c4c\u4f60', '\u5a4a\u5b50', '\u8ce4\u4eba', '\u8d31\u4eba',
  '\u652f\u90a3', '\u9ed1\u9b3c', '\u5f37\u59e6', '\u5f3a\u5978', '\u755c\u751f', '\u53bb\u6b7b', '\u767d\u7661',
  '\u667a\u969c', '\u8166\u6b98', '\u8111\u6b8b', '\u5c3c\u54e5'
];

const LOOK: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g' };
const look = (s: string) => [...s].map(c => LOOK[c] ?? c).join('');

/** Fold a name for matching: lower case, look-alikes to letters, everything but letters and CJK dropped. */
export function foldName(name: string) {
  return look(name.normalize('NFKC').toLowerCase()).replace(/[^\p{L}]/gu, '');
}

/** The name's words: split at spaces, punctuation and camelCase ("xXShitXx" → x, x, shit, xx). */
export function nameWords(name: string) {
  return look(name.normalize('NFKC').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2').toLowerCase()).split(/[^\p{L}]+/u).filter(Boolean);
}

const squeeze = (s: string) => s.replace(/(.)\1+/gu, '$1');

/** Whether a callsign is a slur or abuse. */
export function offensiveName(name: string) {
  const f = foldName(name);
  if (!f) return false;
  if (ZH.some(w => f.includes(w))) return true;
  // Runs are collapsed too ("niiigger", "shiiit").
  const fs = squeeze(f);
  if (ANYWHERE.some(w => f.includes(w) || fs.includes(squeeze(w)))) return true;
  const words = nameWords(name);
  // A name spelled out letter by letter ("s h i t") is one word.
  const candidates = new Set([...words, ...words.map(squeeze), f, fs]);
  return WORDS.some(w => candidates.has(w) || candidates.has(squeeze(w)));
}
