/**
 * Contact sheet of a video for review: `bun trailer/scripts/sheet.ts <video> [out.jpg] [tiles=12] [cols=4]`.
 * Frames are sampled evenly and labelled with their time.
 */
import { FFMPEG, FFPROBE, run } from './util';

const [video, out = video.replace(/\.mp4$/, '.sheet.jpg'), tilesArg = '12', colsArg = '4'] = process.argv.slice(2);
const tiles = Number(tilesArg), cols = Number(colsArg);
const duration = Number((await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video])).trim());
const font = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
await run(FFMPEG, ['-v', 'error', '-y', '-i', video, '-vf',
  `fps=${tiles / duration},scale=640:-1,drawtext=fontfile=${font}:text='%{pts\\:hms}':x=8:y=8:fontsize=24:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=${cols}x${Math.ceil(tiles / cols)}`,
  '-frames:v', '1', out]);
console.log(out);
