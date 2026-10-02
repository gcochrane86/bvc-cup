import { describe, expect, it } from 'vitest';
import { singlesLineup } from './singles';

describe('singlesLineup', () => {
  const fb = { a: ['adams', 'brown'], b: ['green', 'hill'] };
  it('straight: A1 v B1 and A2 v B2', () => {
    expect(singlesLineup(fb, false)).toEqual([['adams', 'green'], ['brown', 'hill']]);
  });
  it('crossed: A1 v B2 and A2 v B1', () => {
    expect(singlesLineup(fb, true)).toEqual([['adams', 'hill'], ['brown', 'green']]);
  });
});
