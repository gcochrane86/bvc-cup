import { describe, it, expect } from 'vitest';
import { freshOnly } from './fresh';

describe('freshOnly', () => {
  it('runs once when not busy', async () => {
    let runs = 0;
    const load = freshOnly(async () => {
      runs++;
    });
    await load();
    expect(runs).toBe(1);
  });

  it('a call during an in-flight run waits for a run that starts after the call', async () => {
    const started: number[] = [];
    let release!: () => void;
    let n = 0;
    const load = freshOnly(async () => {
      const me = ++n;
      started.push(me);
      if (me === 1) await new Promise<void>((r) => (release = r));
    });
    const first = load();
    let secondDone = false;
    const second = load().then(() => (secondDone = true));
    release();
    await first;
    await second;
    expect(secondDone).toBe(true);
    expect(started).toEqual([1, 2]);
  });

  it('collapses many calls during one run into a single follow-up', async () => {
    let n = 0;
    let release!: () => void;
    const load = freshOnly(async () => {
      if (++n === 1) await new Promise<void>((r) => (release = r));
    });
    const calls = [load(), load(), load(), load()];
    release();
    await Promise.all(calls);
    expect(n).toBe(2);
  });
});
