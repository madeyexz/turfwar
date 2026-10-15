/**
 * Chat and callsign moderation (CrazyGames requires a profanity filter where players can chat): bad
 * words are masked with ＊, one per character, and the rest of the line stays. English comes from
 * `obscenity` (its dataset already spares "class", "assassin", "Scunthorpe" and the like, and its
 * transformers catch "sh1t", "f*ck" and "fuuuck"); Mandarin and Taiwanese insults from the list below,
 * in Traditional and Simplified forms. English spelled out one letter at a time ("f u c k", "f.u.c.k")
 * is read as one word. The server runs it on every chat line and callsign (authoritative); Solo, the
 * challenge link and its preview picture run the same code.
 */
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

export const MASK = '＊';

const dataset = englishDataset.build();
const english = new RegExpMatcher({
  ...dataset, ...englishRecommendedTransformers,
  // Everyday words the dataset would mask ("cockpit": the helicopter's).
  whitelistedTerms: [...dataset.whitelistedTerms ?? [], 'cockpit', 'cumin'],
});

/**
 * English spelled one letter at a time: three or more single letters (or the look-alikes @ $ !) with
 * spaces or punctuation between them. The letters are joined and matched as one word on their own,
 * so "a s s e m b l y" is "assembly" and stays, while "f u c k" is masked.
 */
const SPELLED = /(?<![\p{L}\p{N}])[\p{L}\p{N}@$!](?:[\s.,\-_·•~+*/\\|:;'"`^=]+[\p{L}\p{N}@$!]){2,}(?![\p{L}\p{N}])/gu;
const LETTER = /[\p{L}\p{N}@$!]/gu;

/**
 * Mandarin and Taiwanese insults (Hokkien written in Han characters). Phrases rather than single
 * characters where one character is also an everyday word (幹 is "do" in 幹嘛, 能幹, 樹幹).
 */
const CHINESE = [
  // 幹你娘 and its spellings
  '幹你娘', '幹妳娘', '幹您娘', '幹恁娘', '幹拎娘', '幹林娘', '幹你老母', '幹你老師', '幹你老木', '姦你娘', '姦恁娘', '塞你娘', '塞恁娘', '干你娘',
  '操你媽', '操你妈', '操你娘', '操妳媽', '草你媽', '草你妈', '草泥馬', '草泥马', '肏', '屄', '屌你', '屌你老母', '你老母',
  '他媽的', '他妈的', '去你媽', '去你妈', '你媽的', '你妈的', '你娘咧', '尼瑪', '尼玛',
  // Taiwanese
  '靠北', '靠杯', '靠夭', '靠么', '靠腰', '哭夭', '機掰', '機歪', '機八', '雞掰', '雞歪', '雞巴', '鸡巴', '機巴',
  '懶趴', '懶叫', '卵叫', '洨', '破麻', '幹林老師', '北七',
  // Insults
  '王八蛋', '婊子', '賤人', '賤貨', '贱人', '賤婊', '傻逼', '傻屄', '煞筆', '沙比', '智障', '腦殘', '脑残', '白癡', '白痴', '支那', '雜種', '杂种',
];
// Separators slipped between the characters ("幹.你.娘", "靠 北") do not hide a word.
const GAP = '[\\s\\p{P}\\p{S}_]*';
const chinese = new RegExp(CHINESE.map(w => [...w].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(GAP)).join('|'), 'gu');
// 幹 alone is the Taiwanese swear when it stands on its own ("幹!", "幹 好痛"), not inside a word (幹嘛).
const ganAlone = /(?<!\p{Script=Han})幹+(?!\p{Script=Han})/gu;

/** The text with every bad word masked (＊ per character); text without one comes back unchanged. */
export function maskProfanity(text: string): string {
  const masked = new Uint8Array(text.length);
  for (const m of english.getAllMatches(text)) masked.fill(1, m.startIndex, m.endIndex + 1);
  for (const re of [chinese, ganAlone]) for (const m of text.matchAll(re)) masked.fill(1, m.index, m.index + m[0].length);
  for (const run of text.matchAll(SPELLED)) {
    // The joined word, and for each of its UTF-16 units the letter's place in the text.
    let word = '';
    const from: number[] = [];
    for (const l of run[0].matchAll(LETTER)) { word += l[0]; for (let k = 0; k < l[0].length; k++) from.push(run.index + l.index + k); }
    for (const m of english.getAllMatches(word)) for (let k = m.startIndex; k <= m.endIndex; k++) masked[from[k]] = 1;
  }
  if (!masked.includes(1)) return text;
  let out = '', i = 0;
  for (const ch of text) {
    // Spaces and punctuation inside a masked span ("幹 你 娘") stay; letters, digits and the look-alikes @ $ ! become ＊.
    out += masked[i] && /[\p{L}\p{N}@$!]/u.test(ch) ? MASK : ch;
    i += ch.length;
  }
  return out;
}

/** Whether the text has a bad word in it. */
export const hasProfanity = (text: string) => maskProfanity(text) !== text;
