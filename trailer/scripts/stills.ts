/**
 * One still per clip at a given second, tiled two across: `bun trailer/scripts/stills.ts out.jpg clip@sec clip@sec …`
 * (clips from captures/, or captures/<lang>/ with --lang).
 */
import { join } from 'node:path';
import { CAPTURES, FFMPEG, positional, run } from './util';

const [out, ...specs] = positional();
const inputs = specs.flatMap(s => { const [clip, t] = s.split('@'); return ['-ss', t, '-i', join(CAPTURES, `${clip}.mp4`)]; });
const scaled = specs.map((_, i) => `[${i}:v]scale=960:540,setsar=1[v${i}]`).join(';');
const layout = specs.map((_, i) => `${(i % 2) * 960}_${Math.floor(i / 2) * 540}`).join('|');
await run(FFMPEG, ['-v', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${specs.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${specs.length}:layout=${layout}:fill=black`, '-frames:v', '1', out]);
console.log(out);
