<script lang="ts">
  import type { MatchState, Outcome } from '../lib/scoring';

  // editHref: set while the match is open for scoring — each hole then links to its score entry.
  let { state, editHref = null }: { state: MatchState; editHref?: ((hole: number) => string) | null } = $props();
  const nines = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15, 16, 17, 18]];
  const winnerColour = (o: Outcome) => (o === 'A' ? 'var(--team-a)' : o === 'B' ? 'var(--team-b)' : '#8a948f');
  const chip = (lead: number | null) => (lead === null ? '–' : lead === 0 ? 'AS' : `${Math.abs(lead)}UP`);
</script>

<div class="card grid" aria-label="Hole by hole">
  {#each nines as nine, i (i)}
    <div class="nine">
      {#each nine as h (h)}
        {@const o = state.holeWinners[h - 1]}
        {@const lead = state.running[h - 1]}
        <svelte:element
          this={editHref ? 'a' : 'div'}
          class="cell"
          class:current={!state.decided && h === state.thru + 1}
          class:link={!!editHref}
          href={editHref ? editHref(h) : undefined}
          aria-label={editHref ? `Edit hole ${h} scores` : undefined}
        >
          <span class="num" style={o ? `background:${winnerColour(o)};color:#fff;border-color:transparent` : ''}>{h}</span>
          <span class="chip" style={lead ? `background:${lead > 0 ? 'var(--team-a)' : 'var(--team-b)'};color:#fff` : ''}>{chip(lead)}</span>
        </svelte:element>
      {/each}
    </div>
  {/each}
  {#if editHref}<p class="muted small hint">Tap a hole to edit its scores.</p>{/if}
</div>

<style>
  .nine { display: grid; grid-template-columns: repeat(9, 1fr); gap: 2px; }
  .nine + .nine { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px 0; border-radius: 8px; }
  .hint { margin: 10px 0 0; text-align: center; }
  .cell.link { color: inherit; text-decoration: none; cursor: pointer; }
  .cell.link:active { background: var(--line); }
  .cell.current { background: var(--text); }
  .cell.current .num { color: #fff; border-color: #fff; }
  .num {
    width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--line);
    display: grid; place-items: center; font-weight: 700; font-size: 0.8rem;
  }
  .chip { font-size: 0.7rem; font-weight: 800; padding: 3px 4px; border-radius: 6px; min-width: 30px; text-align: center; }
  .cell.current .chip { color: #fff; }
</style>
