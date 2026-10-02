export interface PendingScore {
  roundId: string;
  playerId: string;
  hole: number;
  gross: number | null;
  pickedUp: boolean;
  clientUpdatedAt: string;
  /** A par default the scorer didn't touch: fill the cell only if nobody has entered a score yet. */
  ifAbsent?: boolean;
  /** Wolf: on their own this hole (true/false); left out, the server keeps what it has. */
  lone?: boolean;
}

/** 'exists': an ifAbsent default was skipped because a score is already there. */
export type SendResult = 'ok' | 'stale' | 'locked' | 'exists';

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
  /** The server kept a different value ('exists' / 'stale'): this phone's copy of that cell is wrong. */
  onRefused?: (p: PendingScore) => void;
}) {
  const { storage, send, onChange, onLocked, onRefused } = opts;
  let inFlight: Promise<'done' | 'failed'> | null = null;

  const pending = async () => (await storage.getAll()).sort(byTime);
  const notify = async () => onChange?.(await pending());

  async function enqueue(p: PendingScore) {
    await storage.put(p); // same key -> the newer entry replaces the older one
    await notify();
  }

  async function flush(): Promise<'done' | 'busy' | 'failed'> {
    if (inFlight) return 'busy';
    inFlight = run().finally(() => (inFlight = null));
    return inFlight;
  }

  /** Like flush, but waits for any in-flight flush first instead of returning 'busy'. */
  async function drain(): Promise<'done' | 'failed'> {
    while (inFlight) await inFlight;
    return (await flush()) as 'done' | 'failed';
  }

  async function run(): Promise<'done' | 'failed'> {
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
          if (result === 'exists' || result === 'stale') onRefused?.(p);
        }
      }
    } finally {
      await notify();
    }
  }

  return { enqueue, flush, drain, pending };
}
