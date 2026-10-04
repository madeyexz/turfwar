import { schema, table, t, SenderError, type ReducerCtx, type InferSchema } from 'spacetimedb/server';
import { defaultLaws, parseLawCommand, type Laws } from '../../shared/laws';

// Private rows: reducers always use ctx.sender, never a caller-supplied identity.
// Scores are self-reported session telemetry, NOT an authoritative leaderboard.
const spacetimedb = schema({
  playerState: table({ public: false }, {
    identity: t.identity().primaryKey(),
    lawsJson: t.string(),
    latestCommandJson: t.string(),
    historyJson: t.string(),
    commandCount: t.u32(),
    sessions: t.u32(),
    scoreReports: t.u32(),
    lastReportedScore: t.u32(),
    bestReportedScore: t.u32(),
    updatedAt: t.timestamp(),
  }),
});
export default spacetimedb;

type Context = ReducerCtx<InferSchema<typeof spacetimedb>>;
const increment = (n: number) => Math.min(0xffffffff, n + 1);

function state(ctx: Context) {
  return ctx.db.playerState.identity.find(ctx.sender) ?? ctx.db.playerState.insert({
    identity: ctx.sender,
    lawsJson: JSON.stringify(defaultLaws), latestCommandJson: '', historyJson: '[]',
    commandCount: 0, sessions: 0, scoreReports: 0,
    lastReportedScore: 0, bestReportedScore: 0, updatedAt: ctx.timestamp,
  });
}

export const client_connected = spacetimedb.clientConnected(ctx => {
  const row = state(ctx);
  ctx.db.playerState.identity.update({ ...row, sessions: increment(row.sessions), updatedAt: ctx.timestamp });
});

export const record_law = spacetimedb.reducer({ commandJson: t.string() }, (ctx, { commandJson }) => {
  if (commandJson.length > 2048) throw new SenderError('Law command too large');
  let command;
  try { command = parseLawCommand(JSON.parse(commandJson)); }
  catch { throw new SenderError('Invalid law command'); }
  const row = state(ctx);
  const laws: Laws = JSON.parse(row.lawsJson);
  // Store only normalized, validated data. No code execution or model access here.
  switch (command.kind) {
    case 'gravity': laws.gravity = command.gravity; break;
    case 'time': laws.time = command.time; break;
    case 'lightSpeed': laws.lightSpeed = command.lightSpeed; break;
    case 'rewind': laws.rewind = command.rewind; break;
  }
  const normalized = JSON.stringify(command);
  const history: { command: unknown; at: string }[] = JSON.parse(row.historyJson);
  history.push({ command, at: ctx.timestamp.microsSinceUnixEpoch.toString() });
  ctx.db.playerState.identity.update({
    ...row, lawsJson: JSON.stringify(laws), latestCommandJson: normalized,
    historyJson: JSON.stringify(history.slice(-64)),
    commandCount: increment(row.commandCount), updatedAt: ctx.timestamp,
  });
});

export const record_score = spacetimedb.reducer({ score: t.f64() }, (ctx, { score }) => {
  if (!Number.isFinite(score) || score < 0 || score > 1_000_000 || !Number.isInteger(score)) {
    throw new SenderError('Score must be an integer between 0 and 1000000');
  }
  const row = state(ctx);
  ctx.db.playerState.identity.update({
    ...row, scoreReports: increment(row.scoreReports), lastReportedScore: score,
    bestReportedScore: Math.max(row.bestReportedScore, score), updatedAt: ctx.timestamp,
  });
});
