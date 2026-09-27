<script lang="ts">
  import { formatPoints, type Tracker } from '../lib/scoring';
  import type { EventRow } from '../lib/data/types';

  let { tracker, event, visible }: { tracker: Tracker; event: EventRow; visible: boolean } = $props();
  const pct = (n: number) => (tracker.total ? (n / tracker.total) * 100 : 0);
</script>

<!-- Compact scoreboard that slides in once the full tracker card has scrolled away.
     Big numbers are CONFIRMED points; the bar adds projected points hatched. -->
<div class="wrap" class:visible aria-hidden={!visible} data-testid="score-bar">
  <section class="board">
    <div class="row">
      <strong class="name a">{event.team_a_name}</strong>
      <span class="score a" data-testid="bar-conf-a">{formatPoints(tracker.confirmedA)}</span>
      <span class="divider" aria-hidden="true"></span>
      <span class="score b" data-testid="bar-conf-b">{formatPoints(tracker.confirmedB)}</span>
      <strong class="name b">{event.team_b_name}</strong>
    </div>
    <div class="bar" aria-hidden="true">
      <div class="seg solid a" style="left:0;width:{pct(tracker.confirmedA)}%"></div>
      <div class="seg hatch a" style="left:{pct(tracker.confirmedA)}%;width:{pct(tracker.projectedA - tracker.confirmedA)}%"></div>
      <div class="seg solid b" style="right:0;width:{pct(tracker.confirmedB)}%"></div>
      <div class="seg hatch b" style="right:{pct(tracker.confirmedB)}%;width:{pct(tracker.projectedB - tracker.confirmedB)}%"></div>
      <div class="mid"></div>
    </div>
    <p class="proj">
      Projected {formatPoints(tracker.projectedA)} – {formatPoints(tracker.projectedB)} · {formatPoints(tracker.toWin)} to win
    </p>
  </section>
</div>

<style>
  .wrap {
    position: fixed; top: 0; left: 0; right: 0; z-index: 20;
    background: var(--surface); border-bottom: 1px solid var(--line); box-shadow: 0 2px 8px rgb(0 0 0 / 0.1);
    transform: translateY(-110%); transition: transform 0.22s ease-out; pointer-events: none;
  }
  .wrap.visible { transform: translateY(0); pointer-events: auto; }
  .board { max-width: 560px; margin: 0 auto; padding: max(10px, env(safe-area-inset-top)) 16px 8px; }
  .row { display: grid; grid-template-columns: 1fr auto auto auto 1fr; align-items: center; gap: 10px; }
  .name { text-transform: uppercase; letter-spacing: 0.03em; font-size: 0.8rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name.a { color: var(--team-a); }
  .name.b { color: var(--team-b); text-align: right; }
  .score { font-size: 2rem; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .score.a { color: var(--team-a); }
  .score.b { color: var(--team-b); }
  .divider { width: 2px; height: 30px; background: var(--line); }
  .bar { position: relative; height: 14px; border-radius: 7px; background: var(--line); overflow: hidden; margin: 8px 0 4px; }
  .seg { position: absolute; top: 0; bottom: 0; transition: width 0.4s, left 0.4s, right 0.4s; }
  .solid.a { background: var(--team-a); }
  .solid.b { background: var(--team-b); }
  .hatch.a { background: repeating-linear-gradient(135deg, var(--team-a) 0 5px, color-mix(in srgb, var(--team-a) 30%, white) 5px 10px); }
  .hatch.b { background: repeating-linear-gradient(135deg, var(--team-b) 0 5px, color-mix(in srgb, var(--team-b) 30%, white) 5px 10px); }
  .mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text); }
  .proj { margin: 0; text-align: center; font-size: 0.75rem; color: var(--muted); }
  @media (prefers-reduced-motion: reduce) { .wrap { transition: none; } }
</style>
