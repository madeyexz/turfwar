/**
 * Builds the game's recorded weapon sounds in public/assets/sfx from CC0 sources:
 *
 * - Gunshots: "The Free Firearm Sound Library" (Ben Jaszczak, Brian Nelson, Kevin Heras and
 *   Matthew Nanney, https://opengameart.org/content/the-free-firearm-sound-library). Every
 *   recording holds two to five separate takes; each near-distance take becomes one round-robin
 *   variant (`shot-<weapon>-<n>`), and one mid-distance take per class is the distant layer
 *   (`far-<class>`).
 * - Reload and handling foley (`foley-*`), all CC0 on OpenGameArt: SpringySpringo's "Gun Reload
 *   Sounds", BMacZero's "Gun Reload Sound Effects", zer0_sol's "Handgun Reload Sound Effect" and
 *   "Shotgun Reload Sound Effects", and LFA's "Equipment Clicks III".
 *
 * The library's stereo pairs are widely spaced (left/right of the shooter, near-zero correlation),
 * so the louder, closer channel is kept rather than a phasey mono sum. Shots are trimmed to their
 * onset, high-passed below the wind rumble, faded, driven into a limiter (the 1 ms muzzle spike is
 * shaved by `drive` dB, which brings the body and tail up: a denser, punchier shot) and
 * peak-normalized to -1 dBFS. Everything is mono 44.1 kHz MP3.
 *
 * Needs ffmpeg/ffprobe, curl and bsdtar (macOS ships bsdtar). Run: bun tools/fetch-sounds.ts
 * The 194 MB library archive and the foley downloads are cached in SFX_SRC (default: a temp
 * folder) and not committed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = process.env.SFX_SRC ?? join(tmpdir(), 'lawbreaker-sfx-src');
const OUT = join(import.meta.dir, '../public/assets/sfx');
const ARCHIVE_URL = 'https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z';
const LIB = join(SRC, 'Prepared SFX Library');
const FOLEY = join(SRC, 'foley');
const OGA = 'https://opengameart.org/sites/default/files/';

/** Foley downloads: [cached file, URL, credit]. */
const FOLEY_FILES: [string, string, string][] = [
  ['assaultriflereload1_0.wav', `${OGA}assaultriflereload1_0.wav`, 'SpringySpringo, "Gun Reload Sounds" (https://opengameart.org/content/gun-reload-sounds)'],
  ['gunreload1.wav', `${OGA}gunreload1.wav`, 'SpringySpringo, "Gun Reload Sounds" (https://opengameart.org/content/gun-reload-sounds)'],
  ['clipload1.wav', `${OGA}clipload1.wav`, 'BMacZero (Brian MacIntosh), "Gun Reload Sound Effects" (https://opengameart.org/content/gun-reload-sound-effects)'],
  ['clipload2.wav', `${OGA}clipload2.wav`, 'BMacZero (Brian MacIntosh), "Gun Reload Sound Effects" (https://opengameart.org/content/gun-reload-sound-effects)'],
  ['reload.wav', `${OGA}reload.wav`, 'zer0_sol, "Handgun Reload Sound Effect" (https://opengameart.org/content/handgun-reload-sound-effect)'],
  ['equipment_clicks3.wav', `${OGA}equipment_clicks3.wav`, 'LFA, "Equipment Clicks III" (https://opengameart.org/content/equipment-clicks-iii)'],
  ['shotgunsounds.zip', `${OGA}shotgunsounds.zip`, 'zer0_sol, "Shotgun Reload Sound Effects" (https://opengameart.org/content/shotgun-reload-sound-effects)'],
];

interface Job {
  out: string;
  /** Source path relative to the library (shots) or the foley cache (foley). */
  file: string;
  /** Seconds into the source where the take starts (a little before its transient). */
  at: number;
  seconds: number;
  /** dB of muzzle spike shaved off by the limiter before normalizing (0 = plain peak normalize). */
  drive: number;
  highpass: number;
  lowpass?: number;
  bitrate: number;
  /** Shots refine `at` to the exact onset; foley keeps its hand-picked start. */
  findOnset: boolean;
  foley?: boolean;
}

const shot = (out: string, file: string, takes: number[], seconds: number, drive: number, highpass = 45): Job[] =>
  takes.map((at, i) => ({ out: `${out}-${i + 1}`, file, at, seconds, drive, highpass, bitrate: 96, findOnset: true }));
const far = (out: string, file: string, at: number, seconds: number): Job =>
  ({ out: `far-${out}`, file, at, seconds, drive: 4, highpass: 60, lowpass: 9000, bitrate: 64, findOnset: true });
const foley = (out: string, file: string, at: number, seconds: number, drive = 2): Job =>
  ({ out: `foley-${out}`, file, at, seconds, drive, highpass: 90, bitrate: 80, findOnset: false, foley: true });

const JOBS: Job[] = [
  // Near-distance takes, one round-robin variant each (take times from an onset scan of each file).
  ...shot('shot-m9a1', 'Walther PPQ/X_39P.wav', [1.4, 6.44, 10.655], 0.9, 6),
  ...shot('shot-mp7', 'PPSh/P_30P.wav', [0.962, 4.38, 8.236, 11.414], 0.75, 6, 120),
  ...shot('shot-mp5', 'Carl Gustav M45/G_31P.wav', [0.304, 3.494, 6.72], 0.8, 6),
  ...shot('shot-m4a1', 'AR-15/D_32P.wav', [0.696, 5.64], 1.1, 7),
  ...shot('shot-m249', 'AK-47/C_28P.wav', [0.604, 3.25, 6.014, 9.15], 1.1, 8),
  ...shot('shot-m1014', 'Nova/O_21P.wav', [0.424, 3.458], 1.4, 8, 40),
  ...shot('shot-m1014', 'Model 12/K_22P.wav', [0.836, 7.438], 1.4, 8, 40).map((j, i) => ({ ...j, out: `shot-m1014-${i + 3}` })),
  ...shot('shot-m110', 'Tikka/W_29P.wav', [0.57, 5.658], 1.8, 6, 40),
  ...shot('shot-m110', '1917/B_24P.wav', [1.302, 6.724], 1.8, 6, 40).map((j, i) => ({ ...j, out: `shot-m110-${i + 3}` })),
  // Mid-distance takes (with the environment's slap) for the distant layer, one per class.
  far('pistol', 'Walther PPQ/X_31P.wav', 5.236, 1.4),
  far('smg', 'Carl Gustav M45/G_20P.wav', 2.252, 1.2),
  far('rifle', 'AR-15/D_24P.wav', 0.542, 1.4),
  far('lmg', 'AK-47/C_31P.wav', 4.412, 1.4),
  far('shotgun', 'Nova/O_17P.wav', 3.702, 1.6),
  far('sniper', 'Tikka/W_24P.wav', 0.748, 2.0),
  // Handling foley.
  foley('mag-out', 'assaultriflereload1_0.wav', 0.13, 0.45),
  foley('mag-in', 'assaultriflereload1_0.wav', 1.02, 0.5),
  foley('smg-out', 'gunreload1.wav', 0.06, 0.3),
  foley('smg-in', 'gunreload1.wav', 1.25, 0.35),
  foley('pistol-out', 'reload.wav', 0.08, 0.42),
  foley('pistol-in', 'reload.wav', 0.58, 0.35),
  foley('slide', 'reload.wav', 1.01, 0.42),
  foley('bolt', 'equipment_clicks3.wav', 6.36, 0.3),
  foley('charge', 'equipment_clicks3.wav', 13.1, 0.45),
  foley('clack', 'equipment_clicks3.wav', 21.27, 0.25),
  foley('click', 'clipload1.wav', 0.02, 0.2),
  foley('latch', 'clipload2.wav', 0.03, 0.15),
  foley('shell', 'ShotgunSounds/Subsequent Shells.mp3', 0.64, 0.65),
  foley('rack', 'ShotgunSounds/Rack.mp3', 0.6, 0.5),
];

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr}`);
  return r.stdout + r.stderr;
}
const ff = (args: string[]) => run('ffmpeg', ['-hide_banner', '-nostats', ...args]);

mkdirSync(SRC, { recursive: true });
mkdirSync(FOLEY, { recursive: true });
mkdirSync(OUT, { recursive: true });
const archive = join(SRC, 'ffsl.7z');
if (!existsSync(LIB)) {
  if (!existsSync(archive)) { console.log('Downloading the Free Firearm Sound Library (194 MB)…'); run('curl', ['-fsSL', '-o', archive, ARCHIVE_URL]); }
  run('bsdtar', ['-xf', archive, '-C', SRC]);
}
for (const [file, url] of FOLEY_FILES) {
  const path = join(FOLEY, file);
  if (!existsSync(path)) run('curl', ['-fsSL', '-o', path, url]);
  if (file.endsWith('.zip') && !existsSync(join(FOLEY, 'ShotgunSounds'))) run('bsdtar', ['-xf', path, '-C', FOLEY]);
}

/** The louder channel over the first 300 ms of a take (the library's pairs flank the shooter). */
function closerChannel(input: string, at: number) {
  const stats = ff(['-ss', `${at}`, '-t', '0.3', '-i', input, '-af', 'astats=measure_overall=none:measure_perchannel=RMS_level', '-f', 'null', '-']);
  const rms = [...stats.matchAll(/RMS level dB: (-?[\d.]+|-inf)/g)].map(m => Number(m[1] === '-inf' ? -200 : m[1]));
  return rms.length > 1 && rms[1] > rms[0] ? 1 : 0;
}

let total = 0;
const written = new Set<string>();
for (const job of JOBS) {
  const input = job.foley ? join(FOLEY, job.file) : join(LIB, job.file);
  const channels = Number(run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', input]).trim());
  const ch = channels > 1 ? closerChannel(input, job.at) : 0;
  const pre = job.findOnset ? 0.03 : 0;
  const shape = [
    `pan=mono|c0=c${ch}`,
    `highpass=f=${job.highpass}:poles=2`,
    ...(job.lowpass ? [`lowpass=f=${job.lowpass}`] : []),
    ...(job.findOnset ? ['silenceremove=start_periods=1:start_threshold=-36dB:start_silence=0.002'] : []),
    `atrim=0:${job.seconds}`,
    `afade=t=in:d=0.002`,
    `afade=t=out:st=${(job.seconds * 0.3).toFixed(3)}:d=${(job.seconds * 0.7).toFixed(3)}:curve=exp`,
  ].join(',');
  const seek = ['-ss', `${Math.max(0, job.at - pre)}`, '-t', `${job.seconds + pre + 0.2}`, '-i', input];
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(ff([...seek, '-af', `${shape},volumedetect`, '-f', 'null', '-']))?.[1] ?? 0);
  // Push the spike `drive` dB over the ceiling, let the limiter shave it, and land the peak at -1 dBFS.
  const finish = job.drive > 0
    ? `volume=${(job.drive - 1 - peak).toFixed(2)}dB,alimiter=limit=0.891:attack=0.5:release=40:level=0,volume=-0.05dB`
    : `volume=${(-1 - peak).toFixed(2)}dB`;
  const out = join(OUT, `${job.out}.mp3`);
  ff(['-y', ...seek, '-af', `${shape},${finish}`, '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', `${job.bitrate}k`, out]);
  const duration = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).trim());
  const body = /mean_volume: (-?[\d.]+) dB/.exec(ff(['-t', '0.2', '-i', out, '-af', 'volumedetect', '-f', 'null', '-']))?.[1];
  const size = statSync(out).size;
  total += size;
  written.add(`${job.out}.mp3`);
  console.log(`${job.out.padEnd(18)} ${duration.toFixed(2)} s  ${(size / 1024).toFixed(1).padStart(5)} KB  body ${body} dB  ch${ch}  ← ${job.file} @${job.at}`);
}
for (const file of readdirSync(OUT)) if (file.endsWith('.mp3') && !written.has(file)) { unlinkSync(join(OUT, file)); console.log(`removed stale ${file}`); }
console.log(`total ${(total / 1024).toFixed(1)} KB`);

const credits = [...new Set(FOLEY_FILES.map(([, , credit]) => credit))];
writeFileSync(join(OUT, 'LICENSE.txt'), `All recordings in this folder are CC0 1.0 Universal (no rights reserved):
https://creativecommons.org/publicdomain/zero/1.0/

Gunshots (shot-*, far-*): "The Free Firearm Sound Library" by Ben Jaszczak, Brian Nelson,
Kevin Heras and Matthew Nanney — https://opengameart.org/content/the-free-firearm-sound-library

Handling foley (foley-*), credit not required but given:
${credits.map(c => `- ${c}`).join('\n')}

Cut into single takes, trimmed, faded, limited, peak-normalized and encoded to mono MP3 by
tools/fetch-sounds.ts.

${JOBS.map(j => `${j.out}.mp3 ← ${j.file} @ ${j.at} s`).join('\n')}
`);
