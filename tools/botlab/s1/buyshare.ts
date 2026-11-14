// The primaries that the bots carry, by soldier-round, in full bot-only Online matches (6v6, first to 10 rounds), and the grenades they carry.
// Usage: bun buyshare.ts <path to shared> [matches per map = 3] [first seed - 1 = 0]
const root = process.argv[2] ?? '/home/user/workspace/repo/shared';
const { createContext, createMatch, balanceTeams, tickMatch, TICK_RATE } = await import(root + '/match/sim');
const { ONLINE_CONFIG } = await import(root + '/match/state');
const { rng } = await import(root + '/math');
const n = Number(process.argv[3] ?? 3);
const count: Record<string, number> = {}; let pairs = 0, changes = 0, total = 0, rounds = 0, matches = 0, frags = 0, molotovs = 0, optics = 0, money = 0;
const byRound: Record<number, [number, number]> = {};
for (const map of ['taipei', 'ochre', 'memorial']) for (let seed = 1 + Number(process.argv[4] ?? 0); seed <= n + Number(process.argv[4] ?? 0); seed++) {
  const ctx = createContext(map, rng(seed * 31 + 7), () => {});
  const state = createMatch(map, { ...ONLINE_CONFIG, teamSize: 6, warmup: 1 });
  balanceTeams(state, ctx);
  let last = -1; const prev: Record<number, string> = {};
  for (let i = 0; i < 40 * 60 * TICK_RATE && state.phase !== 'ended'; i++) {
    tickMatch(state, ctx, 1 / TICK_RATE);
    if (state.phase === 'live' && state.round !== last) {
      last = state.round; rounds++;
      for (const s of state.soldiers) {
        if (!s.bot) continue;
        count[s.weapons[0]] = (count[s.weapons[0]] ?? 0) + 1; total++; money += s.money;
        if (prev[s.id] !== undefined) { pairs++; if (prev[s.id] !== s.weapons[0]) changes++; }
        prev[s.id] = s.weapons[0];
        frags += s.grenades > 0 ? 1 : 0; molotovs += s.molotovs > 0 ? 1 : 0; optics += s.attachments[s.weapons[0]]?.optic ? 1 : 0;
        const b = (byRound[state.round] ??= [0, 0]); b[0] += s.weapons[0] === 'mp5' ? 1 : 0; b[1]++;
      }
    }
  }
  matches++;
}
const share = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / total).toFixed(3)}`).join(', ');
console.log(`matches ${matches} rounds/match ${(rounds / matches).toFixed(1)} | ${share} | frag ${(frags / total).toFixed(2)} molotov ${(molotovs / total).toFixed(2)} optic ${(optics / total).toFixed(2)} money ${(money / total).toFixed(0)} | primary changed in ${(changes / pairs).toFixed(3)} of the round pairs`);
console.log('mp5 share by round: ' + Object.entries(byRound).slice(0, 14).map(([r, [a, b]]) => `${r}:${(a / b).toFixed(2)}`).join(' '));
