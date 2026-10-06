/**
 * Listen-check by analysis: for each cut, a spectrogram and waveform of the score and of the final
 * mix (build/analysis/), the loudness curve per second, and the score's hits, stops and cut
 * percussion against the picture's cuts.
 *   bun trailer/scripts/analyze.ts [cut ids…]
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUTS, cutTimes } from '../edit';
import { scoreMarkers } from '../music/score';
import { FFMPEG, ROOT, run } from './util';

const wanted = process.argv.slice(2);
const DIR = join(ROOT, 'build', 'analysis');
mkdirSync(DIR, { recursive: true });

async function images(input: string, name: string) {
  await run(FFMPEG, ['-v', 'error', '-y', '-i', input, '-lavfi', 'showspectrumpic=s=1600x360:legend=1:scale=log,format=rgb24', join(DIR, `${name}.spectrum.png`)]);
  await run(FFMPEG, ['-v', 'error', '-y', '-i', input, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1600x200:colors=0x7ff6ff:scale=sqrt', '-frames:v', '1', join(DIR, `${name}.wave.png`)]);
}
async function curve(input: string) {
  const file = join(DIR, 'momentary.txt');
  await run(FFMPEG, ['-hide_banner', '-nostats', '-i', input, '-map', '0:a', '-af', `ebur128=metadata=1,ametadata=print:key=lavfi.r128.S:file=${file}`, '-f', 'null', '-'], { quiet: true });
  const values = readFileSync(file, 'utf8').split('\n').filter(l => l.includes('r128.S')).map(l => Number(l.split('=')[1]));
  // ebur128 reports every 100 ms: one short-term value per second.
  return values.filter((_, i) => i % 10 === 9).map(v => Math.max(-60, Math.round(v)));
}

for (const cut of CUTS.filter(c => !wanted.length || wanted.includes(c.id))) {
  const music = join(ROOT, 'build', `${cut.id}.music.wav`), final = join(ROOT, 'out', `${cut.id}.mp4`);
  await images(music, `${cut.id}.music`);
  if (existsSync(final)) await images(final, `${cut.id}.final`);
  const cuts = cutTimes(cut), m = scoreMarkers(cut.score, cuts);
  let beat = 0;
  const sections = cut.score.map(([k, b]) => { const s = `${k}@${(beat * 0.5).toFixed(1)}`; beat += b; return s; });
  console.log(`\n${cut.id}`);
  console.log(`  sections: ${sections.join('  ')}`);
  console.log(`  cuts:     ${cuts.map(t => t.toFixed(2)).join(' ')}`);
  const near = (t: number) => cuts.some(c => Math.abs(c - t) < 0.02);
  console.log(`  impacts:  ${m.hits.map(t => `${t.toFixed(2)}${near(t) ? '' : '(off-cut!)'}`).join(' ')}`);
  console.log(`  cut percussion (gun handling): ${m.cocks.map(t => `${t.toFixed(2)}${near(t) ? '' : '(off-cut!)'}`).join(' ')}`);
  console.log(`  silences: ${m.silences.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}`).join(' ')}`);
  console.log(`  score loudness per second (short-term LUFS): ${(await curve(music)).join(' ')}`);
  if (existsSync(final)) console.log(`  final mix loudness per second: ${(await curve(final)).join(' ')}`);
}
console.log(`\nimages in ${DIR}`);
