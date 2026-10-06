/**
 * Assembles the cuts in trailer/edit.ts into trailer/out/<cut>.mp4 (1920×1080, 30 fps, H.264 + AAC):
 * trims each captured clip, punches in on UI shots, flashes and dips on section changes, lays the
 * cards over the picture, mixes the score with the game's own sound (the score leads, the game sits
 * about 5 LU under it, ducked by it, silent over the cards) and masters to -14 LUFS, under -1 dBTP.
 *   bun trailer/scripts/build.ts [cut ids…] [--sound-only] [--lang zh-TW → out/<cut>.zh-TW.mp4]   (--sound-only re-masters the sound onto the finished picture)
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARDS, CUTS, FPS, type Cut, type Segment } from '../edit';
import { cardDir } from './cards';
import { CAPTURES, FFMPEG, FFPROBE, ROOT, SUFFIX, positional, run } from './util';

const wanted = positional();
const BUILD = join(ROOT, 'build'), OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
const X264_INTERMEDIATE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

async function frames(file: string) {
  const out = await run(FFPROBE, ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]);
  return Number(out.trim());
}

/** One segment as a clean intermediate clip of exactly `frames` frames. */
async function segment(seg: Segment, file: string) {
  const n = seg.frames, d = n / FPS;
  const filters: string[] = [];
  let input: string[];
  if (seg.clip.startsWith('card:')) {
    const dir = cardDir(seg.clip.slice(5), n);
    input = ['-framerate', String(FPS), '-i', join(dir, '%05d.png')];
    filters.push('format=yuv420p');
  } else {
    const src = join(CAPTURES, `${seg.clip}.mp4`);
    if (!existsSync(src)) throw new Error(`missing capture ${seg.clip}`);
    const have = await frames(src);
    if (seg.in + n > have) throw new Error(`${seg.clip}: needs frames ${seg.in}..${seg.in + n} but has ${have}`);
    input = ['-i', src];
    filters.push(`trim=start_frame=${seg.in}:end_frame=${seg.in + n}`, 'setpts=PTS-STARTPTS');
    if (seg.zoom) {
      const { scale: z, x, y } = seg.zoom;
      filters.push(`crop=iw/${z}:ih/${z}:(iw-iw/${z})*${x}:(ih-ih/${z})*${y}`);
    }
    filters.push('scale=1920:1080:flags=lanczos');
    // A light grade shared by every gameplay shot: a touch of contrast and a soft vignette.
    filters.push('eq=contrast=1.04:saturation=1.06', 'vignette=angle=PI/6');
  }
  if (seg.enter === 'flash') filters.push('fade=t=in:st=0:d=0.23:color=white');
  if (seg.enter === 'black') filters.push('fade=t=in:st=0:d=0.6:color=black');
  if (seg.exit === 'black') filters.push(`fade=t=out:st=${(d - 0.3).toFixed(3)}:d=0.3:color=black`);
  await run(FFMPEG, ['-v', 'error', '-y', ...input, '-vf', filters.join(','), '-frames:v', String(n), ...X264_INTERMEDIATE, '-an', file]);
}

async function loudness(file: string) {
  const out = await run(FFMPEG, ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { quiet: true, stderr: true });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(out.split('Summary:').pop() ?? '');
  return m ? Number(m[1]) : -70;
}

async function build(cut: Cut) {
  const t0 = Date.now();
  const dir = join(BUILD, 'seg', `${cut.id}${SUFFIX}`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  // ---- Picture ----
  const list: string[] = [];
  const starts: number[] = [];
  let at = 0;
  for (const [i, seg] of cut.segments.entries()) {
    const file = join(dir, `${String(i).padStart(3, '0')}.mp4`);
    await segment(seg, file);
    list.push(`file '${file}'`);
    starts.push(at); at += seg.frames;
  }
  const total = at, seconds = total / FPS;
  writeFileSync(join(dir, 'list.txt'), list.join('\n'));
  const picture = join(BUILD, `${cut.id}${SUFFIX}.picture.mp4`);
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-c', 'copy', picture]);

  // ---- Cards over the picture ----
  const inputs = ['-i', picture];
  const chain: string[] = [];
  let last = '0:v';
  cut.overlays.forEach((o, k) => {
    const n = o.frames ?? CARDS.find(c => c[0] === o.card)![3];
    inputs.push('-framerate', String(FPS), '-i', join(cardDir(o.card, n), '%05d.png'));
    chain.push(`[${k + 1}:v]setpts=PTS+${(o.at / FPS).toFixed(4)}/TB[c${k}]`, `[${last}][c${k}]overlay=eof_action=pass:format=auto[v${k}]`);
    last = `v${k}`;
  });

  // ---- Sound ----
  const mixed = await mix(cut, seconds);
  const outFile = join(OUT, `${cut.id}${SUFFIX}.mp4`);
  const filter = [...chain, `[${last}]format=yuv420p[vout]`, `[${cut.overlays.length + 1}:a]anull[aout]`].join(';');
  await run(FFMPEG, ['-v', 'error', '-y', ...inputs, '-i', mixed, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '256k', '-ac', '2', '-movflags', '+faststart', '-t', seconds.toFixed(3), outFile]);
  console.log(`  ${cut.id}: ${seconds.toFixed(1)} s → ${outFile} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await report(outFile);
}

/** Integrated loudness and true peak of a file's audio (ffmpeg ebur128). */
async function measure(file: string) {
  const out = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { quiet: true, stderr: true });
  const sum = out.split('Summary:').pop() ?? '';
  const num = (re: RegExp) => Number(re.exec(sum)?.[1] ?? NaN);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}
async function report(file: string) {
  const m = await measure(file);
  console.log(`    loudness ${m.I} LUFS integrated, LRA ${m.LRA} LU, true peak ${m.TP} dBTP`);
  return m;
}

/**
 * Score plus game sound, mastered: the game's own sound sits about 5 LU under the score, is ducked by
 * the score where they collide (sidechain), drops out under the cards and dips in the score's silent
 * beats; the sum is brought to -14 LUFS and held under -1 dBTP by a limiter.
 */
async function mix(cut: Cut, seconds: number) {
  const music = join(BUILD, `${cut.id}.music.wav`), sfx = join(BUILD, `${cut.id}${SUFFIX}.sfx.wav`);
  const [lm, ls] = [await loudness(music), await loudness(sfx)];
  const sfxGain = Math.min(6, lm - 5 - ls);
  let at = 0;
  const cards: string[] = [];
  for (const s of cut.segments) { if (s.clip.startsWith('card:')) cards.push(`between(t,${(at / FPS).toFixed(3)},${((at + s.frames) / FPS).toFixed(3)})`); at += s.frames; }
  const stops: string[] = [];
  let beat = 0;
  for (const [kind, beats] of cut.score) {
    const t0 = beat * 0.5, t1 = (beat + beats) * 0.5;
    if (kind === 'silence') stops.push(`between(t,${t0},${t1})`);
    if (kind === 'rise') stops.push(`between(t,${t1 - 0.5},${t1})`);
    beat += beats;
  }
  const sum = join(BUILD, `${cut.id}${SUFFIX}.sum.wav`);
  await run(FFMPEG, ['-v', 'error', '-y', '-i', music, '-i', sfx, '-filter_complex',
    `[0:a]asplit[m][key];[1:a]volume=${sfxGain.toFixed(2)}dB,volume=0:enable='${cards.join('+') || '0'}',volume=0.25:enable='${stops.join('+') || '0'}'[s0];` +
    `[s0][key]sidechaincompress=threshold=0.1:ratio=4:attack=8:release=350:knee=4[s];` +
    `[m][s]amix=inputs=2:normalize=0:duration=first,atrim=0:${seconds.toFixed(3)},afade=t=out:st=${(seconds - 1.5).toFixed(3)}:d=1.5[a]`,
    '-map', '[a]', '-ar', '48000', '-c:a', 'pcm_f32le', sum]);
  // Gain to the target, then a limiter at -2.4 dBFS (headroom for the AAC encode under -1 dBTP); a second pass corrects what the limiter took.
  const master = join(BUILD, `${cut.id}${SUFFIX}.mix.wav`);
  let gain = -14 - (await measure(sum)).I;
  for (let pass = 0; pass < 3; pass++) {
    await run(FFMPEG, ['-v', 'error', '-y', '-i', sum, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.76:attack=1:release=80:level=disabled,aresample=48000`, '-c:a', 'pcm_s24le', master]);
    const m = await measure(master);
    if (Math.abs(m.I + 14) < 0.2) break;
    gain += -14 - m.I;
  }
  console.log(`    music ${lm} LUFS, game ${ls} LUFS → game ${sfxGain.toFixed(1)} dB; master gain ${gain.toFixed(1)} dB`);
  return master;
}

/** Re-master a cut's sound onto its finished picture (no re-encode of the video). */
async function remux(cut: Cut) {
  const file = join(OUT, `${cut.id}${SUFFIX}.mp4`);
  const seconds = cut.segments.reduce((n, s) => n + s.frames, 0) / FPS;
  const mixed = await mix(cut, seconds);
  const tmp = join(BUILD, `${cut.id}${SUFFIX}.remux.mp4`);
  await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-i', mixed, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ac', '2', '-movflags', '+faststart', '-t', seconds.toFixed(3), tmp]);
  renameSync(tmp, file);
  console.log(`  ${cut.id}: new sound on ${file}`);
  await report(file);
}

for (const cut of CUTS.filter(c => !wanted.length || wanted.includes(c.id))) await (process.argv.includes('--sound-only') ? remux(cut) : build(cut));
