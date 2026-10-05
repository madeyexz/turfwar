/**
 * Downloads the CC0 "Free Firearm Sound Library" (Ben Jaszczak, Brian Nelson, Kevin Heras and
 * Matthew Nanney, https://opengameart.org/content/the-free-firearm-sound-library) and turns the
 * single-shot, near-distance recordings the game uses into small mono MP3s in public/assets/sfx.
 * Each shot is trimmed to its onset, faded out, peak-normalized to -1 dBFS and encoded at 64 kb/s.
 *
 * Needs ffmpeg/ffprobe and bsdtar (macOS ships bsdtar). Run: bun tools/fetch-sounds.ts
 * The 194 MB source archive is cached in SFX_SRC (default: a temp folder) and not committed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = process.env.SFX_SRC ?? join(tmpdir(), 'lawbreaker-sfx-src');
const OUT = join(import.meta.dir, '../public/assets/sfx');
const ARCHIVE_URL = 'https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z';
const LIB = join(SRC, 'Prepared SFX Library');

// [output name, source file in the library, seconds kept after the onset]
const SHOTS: [string, string, number][] = [
  ['pistol-9mm', 'Walther PPQ/X_39P.wav', 0.9],
  ['pistol-380', 'Bersa/F_47P.wav', 0.8],
  ['pistol-45', '1911/A_42P.wav', 1.0],
  ['revolver-38', 'Smith & Wesson 642/V_27P.wav', 1.1],
  ['smg-9mm', 'Carl Gustav M45/G_31P.wav', 0.8],
  ['smg-tokarev', 'PPSh/P_30P.wav', 0.8],
  ['shotgun-pump', 'Benelli Nova/O_21P.wav', 1.4],
  ['shotgun-m12', 'Model 12/K_22P.wav', 1.4],
  ['shotgun-break', 'CD/H_21P.wav', 1.3],
  ['rifle-556', 'AR-15/D_32P.wav', 1.1],
  ['rifle-762', 'AK-47/C_28P.wav', 1.1],
  ['rifle-sks', 'SKS/U_14P.wav', 1.2],
  ['sniper-300', 'Savage 10 .300 Blackout/T_27P.wav', 1.6],
  ['sniper-mosin', 'Mosin Nagant/M_21P.wav', 1.8],
  ['sniper-3006', 'Tikka/W_29P.wav', 1.7],
];

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr}`);
  return r.stdout + r.stderr;
}

mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });
const archive = join(SRC, 'ffsl.7z');
if (!existsSync(archive)) { console.log('Downloading the Free Firearm Sound Library (194 MB)…'); run('curl', ['-sSL', '-o', archive, ARCHIVE_URL]); }
if (!existsSync(LIB)) run('bsdtar', ['-xf', archive, '-C', SRC]);

let total = 0;
for (const [name, file, seconds] of SHOTS) {
  // The library folders are named by gun; Benelli's lives in "Nova".
  const input = join(LIB, file.replace('Benelli Nova/', 'Nova/'));
  const shape = `pan=mono|c0=0.5*c0+0.5*c1,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.004,atrim=0:${seconds},afade=t=out:st=${(seconds * 0.55).toFixed(2)}:d=${(seconds * 0.45).toFixed(2)}`;
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(run('ffmpeg', ['-hide_banner', '-i', input, '-af', `${shape},volumedetect`, '-f', 'null', '-']))?.[1] ?? 0);
  const out = join(OUT, `${name}.mp3`);
  run('ffmpeg', ['-hide_banner', '-y', '-i', input, '-af', `${shape},volume=${(-1 - peak).toFixed(2)}dB`, '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', out]);
  const duration = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).trim());
  const size = statSync(out).size;
  total += size;
  console.log(`${name.padEnd(14)} ${duration.toFixed(2)} s  ${(size / 1024).toFixed(1)} KB  ← ${file}`);
}
console.log(`total ${(total / 1024).toFixed(1)} KB`);

writeFileSync(join(OUT, 'LICENSE.txt'), `Gunshot recordings from "The Free Firearm Sound Library" by Ben Jaszczak, Brian Nelson,
Kevin Heras and Matthew Nanney — CC0 1.0 Universal (no rights reserved):
https://opengameart.org/content/the-free-firearm-sound-library
https://creativecommons.org/publicdomain/zero/1.0/

Trimmed, faded, peak-normalized and encoded to mono 64 kb/s MP3 by tools/fetch-sounds.ts.

${SHOTS.map(([name, file]) => `${name}.mp3 ← ${file}`).join('\n')}
`);
