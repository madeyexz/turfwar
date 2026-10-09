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
const ZH = [
  '幹你', '幹妳', '操你', '肏', '靠北', '靠杯', '他媽', '他妈', '你媽', '你妈', '媽的', '妈的', '機掰', '雞掰', '機八', '雞巴', '鸡巴',
  '屌你', '婊子', '賤人', '贱人', '支那', '黑鬼', '強姦', '强奸', '畜生', '去死', '白癡', '智障', '腦殘', '脑残', '尼哥',
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
