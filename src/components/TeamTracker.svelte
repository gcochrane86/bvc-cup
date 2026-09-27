<script lang="ts">
  import { formatPoints, type Tracker } from '../lib/scoring';
  import type { EventRow } from '../lib/data/types';

  let { tracker, event }: { tracker: Tracker; event: EventRow } = $props();
  const pct = (n: number) => (tracker.total ? (n / tracker.total) * 100 : 0);
</script>

<section class="tracker card" data-testid="tracker">
  <div class="bar" aria-hidden="true">
    <div class="seg solid a" style="left:0;width:{pct(tracker.confirmedA)}%"></div>
    <div class="seg hatch a" style="left:{pct(tracker.confirmedA)}%;width:{pct(tracker.projectedA - tracker.confirmedA)}%"></div>
    <div class="seg solid b" style="right:0;width:{pct(tracker.confirmedB)}%"></div>
    <div class="seg hatch b" style="right:{pct(tracker.confirmedB)}%;width:{pct(tracker.projectedB - tracker.confirmedB)}%"></div>
    <div class="mid"></div>
  </div>
  <div class="teams">
    <div>
      <strong class="name" style="color:var(--team-a)">{event.team_a_name}</strong>
      <div class="big" style="color:var(--team-a)"><span data-testid="proj-a">{formatPoints(tracker.projectedA)}</span> <small>projected</small></div>
      <div class="muted small"><span data-testid="conf-a">{formatPoints(tracker.confirmedA)}</span> confirmed</div>
    </div>
    <div class="right">
      <strong class="name" style="color:var(--team-b)">{event.team_b_name}</strong>
      <div class="big" style="color:var(--team-b)"><span data-testid="proj-b">{formatPoints(tracker.projectedB)}</span> <small>projected</small></div>
      <div class="muted small"><span data-testid="conf-b">{formatPoints(tracker.confirmedB)}</span> confirmed</div>
    </div>
  </div>
  <p class="towin muted small">{formatPoints(tracker.toWin)} to win · {formatPoints(tracker.total)} points available</p>
</section>

<style>
  .bar { position: relative; height: 22px; border-radius: 11px; background: var(--line); overflow: hidden; margin-bottom: 12px; }
  .seg { position: absolute; top: 0; bottom: 0; transition: width 0.4s, left 0.4s, right 0.4s; }
  .solid.a { background: var(--team-a); }
  .solid.b { background: var(--team-b); }
  .hatch.a { background: repeating-linear-gradient(135deg, var(--team-a) 0 6px, color-mix(in srgb, var(--team-a) 30%, white) 6px 12px); }
  .hatch.b { background: repeating-linear-gradient(135deg, var(--team-b) 0 6px, color-mix(in srgb, var(--team-b) 30%, white) 6px 12px); }
  .mid { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 3px; margin-left: -1.5px; background: var(--text); }
  .teams { display: flex; justify-content: space-between; gap: 12px; }
  .right { text-align: right; }
  .name { text-transform: uppercase; letter-spacing: 0.02em; }
  .big { font-size: 1.6rem; font-weight: 800; }
  .big small { font-size: 0.8rem; font-weight: 600; }
  .towin { text-align: center; margin: 10px 0 0; }
</style>
