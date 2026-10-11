/** Only fixed categories enter the private error store. Raw logs stay on the host. */
export const SERVER_ERROR_LIMIT = 200;
export function serverErrorSummary(kind: string, count: number) {
  if (!['panic', 'error'].includes(kind) || !Number.isInteger(count) || count < 1 || count > 2000) throw new Error('Invalid server error summary');
  return `${kind === 'panic' ? 'Panic' : 'ERROR'} lines in server log: ${count}. Inspect VM logs for details.`;
}

export function expiredErrorIds(rows: Iterable<{ id: bigint }>, limit = SERVER_ERROR_LIMIT): bigint[] {
  const ids = [...rows].map(r => r.id).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return ids.slice(0, Math.max(0, ids.length - limit));
}
