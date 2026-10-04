import { defaultLaws, parseLawCommand, type LawCommand, type Laws } from '../shared/laws';

export const presets: { title: string; sentence: string; command: LawCommand }[] = [
  { title: 'Break gravity', sentence: 'gravity falls off with the cube of distance', command: { kind: 'gravity', gravity: { ...defaultLaws.gravity, exponent: 3 } } },
  { title: 'Move time', sentence: 'time only moves when I move', command: { kind: 'time', time: { mode: 'playerMotion', scale: 1 } } },
  { title: 'Slow light', sentence: 'light travels at walking speed', command: { kind: 'lightSpeed', lightSpeed: { c: 10 } } },
  { title: 'Rewind', sentence: 'rewind the last 5 seconds', command: { kind: 'rewind', rewind: { seconds: 5 } } },
];

const power = (n: number) => (n === 2 ? 'square' : n === 3 ? 'cube' : n === 1 ? 'first power' : n === 0 ? 'zeroth power (constant)' : `power ${n}`);
const sup = (n: number) => (n === 2 ? '²' : n === 3 ? '³' : `^${n}`);

/** Plain-language description of the current laws for the HUD. */
export function describeLaws(laws: Laws) {
  const g = laws.gravity;
  const gravity = g.mode === 'central'
    ? { text: g.strength >= 0 ? `The reactor pulls with the inverse ${power(g.exponent)} of distance.` : `The reactor repels with the inverse ${power(g.exponent)} of distance.`, value: `F ∝ 1/r${sup(g.exponent)} · μ = ${g.strength}` }
    : { text: `Gravity pulls ${describeDirection(g.direction)} on every lawful body.`, value: `g = ${g.strength} m/s² · (${g.direction.x}, ${g.direction.y}, ${g.direction.z})` };
  return [
    { icon: '◎', title: 'GRAVITY', ...gravity },
    { icon: '◷', title: 'TIME', text: laws.time.mode === 'constant' ? (laws.time.scale === 1 ? 'Time moves at a constant pace.' : `The world runs at ${laws.time.scale.toFixed(2)}× speed.`) : 'Time only moves when the lawbreaker moves.', value: `t × ${laws.time.scale.toFixed(2)}${laws.time.mode === 'playerMotion' ? ' × motion' : ''}` },
    { icon: '☼', title: 'LIGHT', text: laws.lightSpeed.c <= 12 ? 'Light travels at walking speed.' : laws.lightSpeed.c < 100 ? 'Light is slow enough to see it bend.' : 'Light travels far faster than you.', value: `c = ${laws.lightSpeed.c} m/s · visual approximation` },
    { icon: '↶', title: 'REWIND', text: 'The past is not set in stone.', value: `${laws.rewind.seconds}s of world history · you stay free` },
  ];
}

function describeDirection(d: { x: number; y: number; z: number }) {
  if (d.y < -0.7) return 'down';
  if (d.y > 0.7) return 'up';
  return 'sideways';
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
