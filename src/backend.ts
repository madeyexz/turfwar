import { parseLawCommand, type LawCommand } from '../shared/laws';
import type { DbConnection } from './module_bindings';

export type BackendStatus = 'offline' | 'connecting' | 'connected' | 'error';
let connection: DbConnection | undefined;
let connected = false;
let notify: (status: BackendStatus) => void = () => {};
let generation = 0;

/** Optional persistence. With no Vite configuration the game stays fully offline. */
export function connectBackend(onStatus: (status: BackendStatus) => void): () => void {
  const current = ++generation;
  try { connection?.disconnect(); } catch { /* Already disconnected. */ }
  connection = undefined;
  connected = false;
  notify = onStatus;
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const uri = env?.VITE_SPACETIMEDB_URI;
  const database = env?.VITE_SPACETIMEDB_DATABASE;
  const status = (value: BackendStatus) => { if (generation === current) onStatus(value); };
  const cleanup = () => {
    if (generation !== current) return;
    ++generation;
    connected = false;
    try { connection?.disconnect(); } catch { /* Already disconnected. */ }
    connection = undefined;
    notify = () => {};
  };
  if (!uri || !database) { status('offline'); return cleanup; }
  status('connecting');
  const tokenKey = `lawbreaker.identity:${uri}:${database}`;
  let token: string | undefined;
  try { token = localStorage.getItem(tokenKey) || undefined; } catch { /* Storage may be disabled. */ }
  void import('./module_bindings').then(({ DbConnection }) => {
    if (generation !== current) return;
    connection = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect((_ctx, _identity, nextToken) => {
        if (generation !== current) return;
        connected = true;
        try { localStorage.setItem(tokenKey, nextToken); } catch { /* Anonymous identity still works. */ }
        status('connected');
      })
      .onConnectError(() => { if (generation === current) connected = false; status('error'); })
      .onDisconnect(() => { if (generation === current) connected = false; status('offline'); })
      .build();
  }).catch(() => { status('error'); });
  return cleanup;
}

/** False means not persisted; offline calls are deliberately not queued. */
export async function recordLaw(command: LawCommand): Promise<boolean> {
  if (!connected || !connection) return false;
  try {
    await connection.reducers.recordLaw({ commandJson: JSON.stringify(parseLawCommand(command)) });
    return true;
  } catch { notify('error'); return false; }
}

/** Self-reported telemetry only, never a competitive score submission. */
export async function recordScore(score: number): Promise<boolean> {
  if (!connected || !connection || !Number.isInteger(score) || score < 0 || score > 1_000_000) return false;
  try { await connection.reducers.recordScore({ score }); return true; }
  catch { notify('error'); return false; }
}
