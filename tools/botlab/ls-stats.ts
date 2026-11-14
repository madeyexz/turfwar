import { listAll, r2 } from '/home/user/workspace/repo/tools/recorder/r2';
const c = r2('turfwar-rec', 'R2_REC_READ');
const prefix = process.argv[2] ?? 'v1';
const rows = await listAll(c, `${prefix}/stats/`);
for (const r of rows) console.log(r.key, r.size, r.lastModified ?? '');
console.log('count', rows.length, 'now', new Date().toISOString());
