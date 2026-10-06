/**
 * Assembles the cuts in trailer/edit.ts into trailer/out/<cut>.mp4 (1920×1080, 30 fps, H.264 + AAC):
 * trims each captured clip, punches in on UI shots, flashes and dips on section changes, lays the
 * cards over the picture, mixes the score with the game's own sound (the score leads, the game sits
 * about 5 LU under it, silent over the title and end cards) and normalizes to -14 LUFS.
 *   bun trailer/scripts/build.ts [cut ids…]
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARDS, CUTS, FPS, type Cut, type Segment } from '../edit';
import { cardDir } from './cards';
import { FFMPEG, FFPROBE, ROOT, run } from './util';

const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));
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
    const src = join(ROOT, 'captures', `${seg.clip}.mp4`);
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
  const dir = join(BUILD, 'seg', cut.id);
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
  const picture = join(BUILD, `${cut.id}.picture.mp4`);
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
  const music = join(BUILD, `${cut.id}.music.wav`), sfx = join(BUILD, `${cut.id}.sfx.wav`);
  const [lm, ls] = [await loudness(music), await loudness(sfx)];
  const sfxGain = Math.min(6, lm - 5 - ls);
  const quiet = cut.segments.map((s, i) => s.clip.startsWith('card:') ? `between(t,${(starts[i] / FPS).toFixed(3)},${((starts[i] + s.frames) / FPS).toFixed(3)})` : '').filter(Boolean).join('+') || '0';
  const mixed = join(BUILD, `${cut.id}.mix.wav`);
  await run(FFMPEG, ['-v', 'error', '-y', '-i', music, '-i', sfx, '-filter_complex',
    `[1:a]volume=${sfxGain.toFixed(2)}dB,volume=0:enable='${quiet}'[s];[0:a][s]amix=inputs=2:normalize=0:duration=first,atrim=0:${seconds.toFixed(3)},afade=t=out:st=${(seconds - 1.5).toFixed(3)}:d=1.5[a]`,
    '-map', '[a]', '-ar', '48000', mixed]);
  // Two-pass, linear loudness normalization to -14 LUFS with a -1 dBTP ceiling (keeps the dynamics).
  const probe = await run(FFMPEG, ['-hide_banner', '-i', mixed, '-af', 'loudnorm=I=-14:TP=-1:LRA=14:print_format=json', '-f', 'null', '-'], { quiet: true, stderr: true });
  const j = JSON.parse(probe.slice(probe.lastIndexOf('{'), probe.lastIndexOf('}') + 1));
  const norm = `loudnorm=I=-14:TP=-1:LRA=14:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;

  const outFile = join(OUT, `${cut.id}.mp4`);
  const filter = [...chain, `[${last}]format=yuv420p[vout]`, `[${cut.overlays.length + 1}:a]${norm},aresample=48000[aout]`].join(';');
  await run(FFMPEG, ['-v', 'error', '-y', ...inputs, '-i', mixed, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '256k', '-ac', '2', '-movflags', '+faststart', '-t', seconds.toFixed(3), outFile]);
  console.log(`  ${cut.id}: ${seconds.toFixed(1)} s → ${outFile} (music ${lm} LUFS, game ${ls} LUFS → ${sfxGain.toFixed(1)} dB) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

for (const cut of CUTS.filter(c => !wanted.length || wanted.includes(c.id))) await build(cut);
