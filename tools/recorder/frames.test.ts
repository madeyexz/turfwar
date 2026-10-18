import { describe, expect, it } from 'vitest';
import { BinaryWriter } from 'spacetimedb';
import { ClientMessage, ServerMessage } from '../../node_modules/spacetimedb/src/sdk/client_api/types';
import { Frame, MatchEvent } from '../../src/module_bindings/types';
import { checkRowTypes, readMessage, subscribeMessage, unsubscribeMessage } from './frames';

// The hand-written reader against the SDK's own serializers: an SDK upgrade that moves a field fails here.
const bytes = (write: (w: BinaryWriter) => void) => { const w = new BinaryWriter(64); write(w); return w.getBuffer().slice(); };
const rows = (write: (w: BinaryWriter) => void, offsets = true) => ({
  sizeHint: offsets ? { tag: 'RowOffsets' as const, value: [0n] } : { tag: 'FixedSize' as const, value: 0 },
  rowsData: bytes(write),
});
const wire = (msg: Parameters<typeof ServerMessage.serialize>[1]) => new Uint8Array([0, ...bytes(w => ServerMessage.serialize(w, msg))]);
const read = (data: Uint8Array) => {
  const got: unknown[] = [], errors: string[] = [];
  readMessage(data, { frame: f => got.push(['frame', f.id, f.mapId, [...f.data]]), event: e => got.push(['event', e.room, e.json]) }, e => errors.push(e));
  return { got, errors };
};

describe('recorder frame reader', () => {
  it('matches the generated row types', () => expect(checkRowTypes).not.toThrow());

  it('reads frames and events from a transaction update in their order, skipping other tables and old rows', () => {
    const data = wire({ tag: 'TransactionUpdate', value: { querySets: [
      { querySetId: { id: 3 }, tables: [
        { tableName: 'frame', rows: [{ tag: 'PersistentTable', value: {
          inserts: rows(w => { Frame.serialize(w, { id: 2, mapId: 'taipei', data: new Uint8Array([6, 1, 2]) }); Frame.serialize(w, { id: 5, mapId: '', data: new Uint8Array() }); }),
          deletes: rows(w => Frame.serialize(w, { id: 2, mapId: 'old', data: new Uint8Array([9]) })),
        } }] },
        { tableName: 'roster', rows: [{ tag: 'PersistentTable', value: { inserts: rows(w => w.writeU32(7), false), deletes: rows(() => {}, false) } }] },
      ] },
      { querySetId: { id: 4 }, tables: [
        { tableName: 'match_event', rows: [{ tag: 'EventTable', value: { events: rows(w => { MatchEvent.serialize(w, { seq: 1, json: '{"t":"kill"}', room: 2 }); MatchEvent.serialize(w, { seq: 2, json: '台北', room: 0 }); }) } }] },
      ] },
    ] } });
    expect(read(data)).toEqual({ errors: [], got: [
      ['frame', 2, 'taipei', [6, 1, 2]], ['frame', 5, '', []], ['event', 2, '{"t":"kill"}'], ['event', 0, '台北'],
    ] });
  });

  it("reads a subscription's first rows and its errors", () => {
    expect(read(wire({ tag: 'SubscribeApplied', value: { requestId: 1, querySetId: { id: 2 }, rows: { tables: [
      { table: 'frame', rows: rows(w => Frame.serialize(w, { id: 1, mapId: 'ochre', data: new Uint8Array([6]) })) },
    ] } } })).got).toEqual([['frame', 1, 'ochre', [6]]]);
    expect(read(wire({ tag: 'SubscriptionError', value: { requestId: 9, querySetId: { id: 2 }, error: 'no such table' } })).errors).toEqual(['no such table']);
    expect(read(wire({ tag: 'SubscriptionError', value: { requestId: undefined, querySetId: { id: 2 }, error: 'gone' } })).errors).toEqual(['gone']);
  });

  it('writes the messages the SDK writes', () => {
    expect([...subscribeMessage(7, 3, ['SELECT * FROM frame WHERE id = 1', 'SELECT 台'])]).toEqual([...bytes(w => ClientMessage.serialize(w, {
      tag: 'Subscribe', value: { requestId: 7, querySetId: { id: 3 }, queryStrings: ['SELECT * FROM frame WHERE id = 1', 'SELECT 台'] },
    }))]);
    expect([...unsubscribeMessage(8, 3)]).toEqual([...bytes(w => ClientMessage.serialize(w, {
      tag: 'Unsubscribe', value: { requestId: 8, querySetId: { id: 3 }, flags: { tag: 'Default' } },
    }))]);
  });

  it('refuses a compressed message', () => expect(() => read(new Uint8Array([1, 4]))).toThrow(/compressed/));
});
