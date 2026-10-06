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

/** Run a command; reject with its stderr on failure. Returns stdout. */
export function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; if (!opts.quiet && process.env.TRAILER_VERBOSE) process.stderr.write(d); });
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.slice(0, 6).join(' ')}… exited ${code}\n${err.slice(-3000)}`)));
  });
}
