/** Shared paths and a process runner for the trailer tools. */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

/** trailer/ */
export const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
export const REPO = join(ROOT, '..');
export const FFMPEG = process.env.FFMPEG ?? (Bun.which('ffmpeg') ? 'ffmpeg' : '/opt/homebrew/bin/ffmpeg');
export const FFPROBE = process.env.FFPROBE ?? (Bun.which('ffprobe') ? 'ffprobe' : '/opt/homebrew/bin/ffprobe');
/** Frame rate of every capture and of the cut. */
export const FPS = 30;

/** Run a command; reject with its stderr on failure. Returns stdout (or stderr with `stderr: true`). */
export function run(cmd: string, args: string[], opts: { quiet?: boolean; stderr?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; if (!opts.quiet && process.env.TRAILER_VERBOSE) process.stderr.write(d); });
    p.on('close', code => code === 0 ? resolve(opts.stderr ? err : out) : reject(new Error(`${cmd} ${args.slice(0, 6).join(' ')}… exited ${code}\n${err.slice(-3000)}`)));
  });
}

/**
 * Language of the trailer being made: `--lang zh-TW` (or TRAILER_LANG) films the game with `?lang=zh-TW`,
 * renders the cards in Chinese and writes `out/<cut>.zh-TW.mp4`. English keeps the plain paths.
 */
const langFlag = process.argv.indexOf('--lang');
export const LANG = (langFlag >= 0 ? process.argv[langFlag + 1] : process.env.TRAILER_LANG) || 'en';
if (!['en', 'zh-TW'].includes(LANG)) throw new Error(`unsupported --lang ${LANG} (en or zh-TW)`);
/** `.zh-TW` for a localized cut's files, '' for English. */
export const SUFFIX = LANG === 'en' ? '' : `.${LANG}`;
/** Captured clips and sound logs for the current language. */
export const CAPTURES = join(ROOT, 'captures', LANG === 'en' ? '' : LANG);
/** Positional arguments (not flags, not a flag's value). */
export const positional = () => process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--lang' && all[i - 1] !== '--only');
