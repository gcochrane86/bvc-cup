import { describe, it, expect, vi } from 'vitest';
import { createOutbox, pendingKey, type OutboxStorage, type PendingScore, type SendResult } from './outbox';

function memoryStorage(): OutboxStorage & { map: Map<string, PendingScore> } {
  const map = new Map<string, PendingScore>();
  return {
    map,
    getAll: async () => [...map.values()],
    get: async (k) => map.get(k),
    put: async (p) => { map.set(pendingKey(p), p); },
    remove: async (k) => { map.delete(k); },
  };
}
const p = (hole: number, at: string, gross: number | null = 4): PendingScore => ({
  roundId: 'r', playerId: 'x', hole, gross, pickedUp: false, clientUpdatedAt: at,
});

describe('outbox', () => {
  it('sends queued scores oldest first and empties', async () => {
    const storage = memoryStorage();
    const sent: number[] = [];
    const ob = createOutbox({ storage, send: async (x) => { sent.push(x.hole); return 'ok'; } });
    await ob.enqueue(p(2, '2026-10-01T10:00:02Z'));
    await ob.enqueue(p(1, '2026-10-01T10:00:01Z'));
    expect(await ob.flush()).toBe('done');
    expect(sent).toEqual([1, 2]);
    expect(storage.map.size).toBe(0);
  });

  it('keeps items and reports failure when sending throws', async () => {
    const storage = memoryStorage();
    const ob = createOutbox({ storage, send: async () => { throw new Error('offline'); } });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    expect(await ob.flush()).toBe('failed');
    expect(storage.map.size).toBe(1);
  });

  it('replaces an older pending entry for the same cell', async () => {
    const storage = memoryStorage();
    const ob = createOutbox({ storage, send: async () => 'ok' });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z', 4));
    await ob.enqueue(p(1, '2026-10-01T10:00:05Z', 6));
    expect((await ob.pending()).map((x) => x.gross)).toEqual([6]);
  });

  it('sends a newer entry queued while an older one was in flight', async () => {
    const storage = memoryStorage();
    const sent: (number | null)[] = [];
    let ob!: ReturnType<typeof createOutbox>;
    const send = async (x: PendingScore): Promise<SendResult> => {
      sent.push(x.gross);
      if (x.gross === 4) await ob.enqueue(p(1, '2026-10-01T10:00:09Z', 5));
      return 'ok';
    };
    ob = createOutbox({ storage, send });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z', 4));
    expect(await ob.flush()).toBe('done');
    expect(sent).toEqual([4, 5]);
    expect(storage.map.size).toBe(0);
  });

  it('drops locked scores and reports them', async () => {
    const storage = memoryStorage();
    const onLocked = vi.fn();
    const ob = createOutbox({ storage, send: async () => 'locked', onLocked });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    expect(await ob.flush()).toBe('done');
    expect(onLocked).toHaveBeenCalledOnce();
    expect(storage.map.size).toBe(0);
  });

  it('refuses overlapping flushes', async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ob = createOutbox({ storage, send: async () => { await gate; return 'ok'; } });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    const first = ob.flush();
    expect(await ob.flush()).toBe('busy');
    release();
    expect(await first).toBe('done');
  });

  it('drain waits for an in-flight flush and leaves nothing pending', async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ob = createOutbox({ storage, send: async () => { await gate; return 'ok'; } });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    const first = ob.flush();
    const drained = ob.drain();
    release();
    expect(await drained).toBe('done');
    expect(storage.map.size).toBe(0);
    expect(await first).toBe('done');
  });

  it('reports the pending list on change', async () => {
    const onChange = vi.fn();
    const ob = createOutbox({ storage: memoryStorage(), send: async () => 'ok', onChange });
    await ob.enqueue(p(1, '2026-10-01T10:00:00Z'));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ hole: 1 })]);
    await ob.flush();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
