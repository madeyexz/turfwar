import { defaultLaws, parseLawCommand, type LawCommand, type Laws } from '../shared/laws';

export const presets: { title: string; sentence: string; command: LawCommand }[] = [
  { title: 'Break gravity', sentence: 'gravity falls off with the cube of distance', command: { kind: 'gravity', gravity: { ...defaultLaws.gravity, exponent: 3 } } },
  { title: 'Move time', sentence: 'time only moves when I move', command: { kind: 'time', time: { mode: 'playerMotion', scale: 1 } } },
  { title: 'Slow light', sentence: 'light travels at walking speed', command: { kind: 'lightSpeed', lightSpeed: { c: 10 } } },
  { title: 'Rewind', sentence: 'rewind the last 5 seconds', command: { kind: 'rewind', rewind: { seconds: 5 } } },
];

export function describeLaws(laws: Laws) {
  const g = laws.gravity;
  return [
    { icon: '◎', title: 'GRAVITY', text: g.mode === 'central' ? `Gravity follows the inverse ${g.exponent === 2 ? 'square' : g.exponent === 3 ? 'cube' : `power ${g.exponent}`} of distance.` : 'Gravity pulls in one uniform direction.', value: g.mode === 'central' ? `F ∝ 1/r${g.exponent === 2 ? '²' : g.exponent === 3 ? '³' : `^${g.exponent}`} · μ = ${g.strength}` : `g = ${g.strength} m/s² · (${g.direction.x}, ${g.direction.y}, ${g.direction.z})` },
    { icon: '◷', title: 'TIME', text: laws.time.mode === 'constant' ? 'Time moves at a constant pace.' : 'Time only moves when you move.', value: `t × ${laws.time.scale.toFixed(2)}${laws.time.mode === 'playerMotion' ? ' × motion' : ''}` },
    { icon: '☼', title: 'LIGHT', text: laws.lightSpeed.c <= 10 ? 'Light travels at walking speed.' : 'Light travels faster than you.', value: `c = ${laws.lightSpeed.c} m/s · visual approximation` },
    { icon: '↶', title: 'REWIND', text: 'The past is not set in stone.', value: `${laws.rewind.seconds} seconds · player stays free` },
  ];
}

/** Known examples work offline; arbitrary language is handled only by the server. */
export function offlineCommand(text: string): LawCommand | undefined {
  const normalized = text.trim().toLowerCase().replace(/[.!]$/, '');
  return presets.find(p => p.sentence.toLowerCase() === normalized)?.command;
}

export async function translateCommand(text: string): Promise<{ command: LawCommand; source: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('/api/law', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: controller.signal });
    if (!response.ok) throw new Error('AI translation is unavailable. Use an example or a preset.');
    const data = await response.json();
    return { command: parseLawCommand(data.command), source: 'AI TRANSLATION' };
  } catch {
    const known = offlineCommand(text);
    if (known) return { command: parseLawCommand(known), source: 'OFFLINE PRESET' };
    throw new Error('AI translation is unavailable. Choose one of the four examples below.');
  } finally { clearTimeout(timer); }
}
