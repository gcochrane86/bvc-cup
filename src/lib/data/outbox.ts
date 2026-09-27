export interface PendingScore {
  roundId: string;
  playerId: string;
  hole: number;
  gross: number | null;
  pickedUp: boolean;
  clientUpdatedAt: string;
}

export type SendResult = 'ok' | 'stale' | 'locked';

export interface OutboxStorage {
  getAll(): Promise<PendingScore[]>;
  get(key: string): Promise<PendingScore | undefined>;
  put(p: PendingScore): Promise<void>;
  remove(key: string): Promise<void>;
}

export const pendingKey = (p: Pick<PendingScore, 'roundId' | 'playerId' | 'hole'>) => `${p.roundId}:${p.playerId}:${p.hole}`;

const byTime = (a: PendingScore, b: PendingScore) => Date.parse(a.clientUpdatedAt) - Date.parse(b.clientUpdatedAt);

export function createOutbox(opts: {
  storage: OutboxStorage;
  send: (p: PendingScore) => Promise<SendResult>;
  onChange?: (pending: PendingScore[]) => void;
  onLocked?: (p: PendingScore) => void;
}) {
  const { storage, send, onChange, onLocked } = opts;
  let flushing = false;

  const pending = async () => (await storage.getAll()).sort(byTime);
  const notify = async () => onChange?.(await pending());

  async function enqueue(p: PendingScore) {
    await storage.put(p); // same key -> the newer entry replaces the older one
    await notify();
  }

  async function flush(): Promise<'done' | 'busy' | 'failed'> {
    if (flushing) return 'busy';
    flushing = true;
    try {
      for (;;) {
        const items = await pending();
        if (items.length === 0) return 'done';
        for (const p of items) {
          let result: SendResult;
          try {
            result = await send(p);
          } catch {
            return 'failed';
          }
          // Only remove if nothing newer was queued for this cell while we were sending.
          const current = await storage.get(pendingKey(p));
          if (current && current.clientUpdatedAt === p.clientUpdatedAt) await storage.remove(pendingKey(p));
          if (result === 'locked') onLocked?.(p);
        }
      }
    } finally {
      flushing = false;
      await notify();
    }
  }

  return { enqueue, flush, pending };
}
