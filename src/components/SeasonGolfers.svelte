<script lang="ts">
  // Season team events: tick a day's golfers (in team colours). The line underneath says what the day will
  // be — 1 v 1, 2 v 1 (and who plays alone) or fourballs — or why it can't be played for the cup.
  import { seasonDayCheck, type Team } from '../lib/scoring';

  let {
    players,
    teamName,
    selected = $bindable(),
    picking = true,
  }: {
    players: { id: string; name: string; short: string; team: Team }[];
    teamName: (t: Team) => string;
    selected: string[];
    /** false: just the line for an already-chosen list (e.g. "Same as Day 1"). */
    picking?: boolean;
  } = $props();

  const teamOf = $derived(Object.fromEntries(players.map((p) => [p.id, p.team])) as Record<string, Team>);
  const check = $derived(seasonDayCheck(selected, teamOf));
  const shortOf = (id: string) => players.find((p) => p.id === id)?.short ?? '?';
  const line = $derived.by(() => {
    const n = selected.length;
    if (!('error' in check)) {
      if (check.format === 'one_v_one') return '2 golfers · 1 v 1';
      if (check.format === 'two_v_one') return `3 golfers · 2 v 1 · ${shortOf(check.single)} plays alone`;
      return `${n} golfers · fourballs`;
    }
    if (check.error === 'too_few') return 'Pick at least 2 golfers.';
    if (check.error === 'no_team') return 'Everyone needs a team first (Players).';
    if (check.error !== 'same_team') return '';
    return n === 2
      ? `These 2 are both on ${teamName(check.team)}. A 1 v 1 needs one golfer from each team.`
      : `These 3 are all on ${teamName(check.team)}. A 2 v 1 needs golfers from both teams.`;
  });

  function toggle(id: string, on: boolean) {
    selected = on ? [...selected, id] : selected.filter((x) => x !== id);
  }
</script>

{#if picking}
<div class="golfers">
  {#each players as p (p.id)}
    <label class="golfer" class:on={selected.includes(p.id)} style="--c:var(--team-{p.team.toLowerCase()})">
      <input type="checkbox" aria-label="{p.name} golfer" checked={selected.includes(p.id)} onchange={(e) => toggle(p.id, (e.currentTarget as HTMLInputElement).checked)} />
      {p.short}
    </label>
  {/each}
</div>
{/if}
<p class="format" class:bad={'error' in check} data-testid="day-format">{line}</p>

<style>
  .golfers { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
  .golfer {
    display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--line);
    border-left: 5px solid var(--c); font-size: 0.85rem; cursor: pointer; margin: 0;
  }
  .golfer.on { background: color-mix(in srgb, var(--c) 12%, white); border-color: var(--c); }
  .golfer input { width: 16px; height: 16px; margin: 0; accent-color: var(--c); }
  .format { margin: 4px 0 10px; font-size: 0.85rem; font-weight: 600; color: var(--shot-text); }
  .format.bad { color: #a0521a; }
</style>
