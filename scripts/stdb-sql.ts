import { spawnSync } from 'node:child_process';

/**
 * Read-only `spacetime sql … --format json` for the owner's scripts: rows come back as plain
 * objects keyed by column name; identities as hex strings and timestamps as epoch microseconds.
 */
interface Column { name: { some?: string }; algebraic_type: Record<string, unknown> }
interface Result { schema: { elements: Column[] }; rows: unknown[][] }

/** Unwrap SATS JSON: `[x]` single-field products (identity, timestamp) become `x`. */
function plain(type: Record<string, unknown>, value: unknown): unknown {
  const product = type.Product as { elements: { name: { some?: string }; algebraic_type: Record<string, unknown> }[] } | undefined;
  if (product && Array.isArray(value)) {
    const els = product.elements;
    if (els.length === 1) {
      const inner = plain(els[0].algebraic_type, value[0]);
      const name = els[0].name.some ?? '';
      if (name === '__identity__') return typeof inner === 'string' ? inner.replace(/^0x/, '') : BigInt(inner as number).toString(16).padStart(64, '0');
      if (name === '__timestamp_micros_since_unix_epoch__') return BigInt(inner as number | string);
      return inner;
    }
    return Object.fromEntries(els.map((e, i) => [e.name.some ?? String(i), plain(e.algebraic_type, value[i])]));
  }
  return value;
}

export function sql(server: string, db: string, query: string): Record<string, unknown>[] {
  const run = spawnSync('spacetime', ['sql', db, query, '--server', server, '--format', 'json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`spacetime sql failed (${query}): ${run.stderr.trim()}`);
  const json = run.stdout.slice(run.stdout.indexOf('['));
  const results = JSON.parse(json) as Result[];
  const out: Record<string, unknown>[] = [];
  for (const r of results) {
    const cols = r.schema.elements;
    for (const row of r.rows) out.push(Object.fromEntries(cols.map((c, i) => [c.name.some ?? String(i), plain(c.algebraic_type, row[i])])));
  }
  return out;
}
