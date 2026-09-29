<script lang="ts">
  // Confirmed results for one event (active or not), each with Reopen — on the event's admin page.
  import { db, fetchEventData, loadAll, playerShort } from '../lib/data/store.svelte';
  import { must, supabase } from '../lib/supabase';
  import { buildEventView, matchesLabel, matchLabel, type EventView, type GroupView } from '../lib/view';
  import type { EventRow } from '../lib/data/types';

  let { event }: { event: EventRow } = $props();

  let view = $state<EventView | null>(null);
  async function load() {
    const data = await fetchEventData(event.id);
    view = buildEventView({ event, players: db.players, courses: db.courses, courseHoles: db.courseHoles, ...data });
  }
  $effect(() => {
    void load();
  });

  const confirmed = $derived(
    (view?.rounds ?? [])
      .map((round) => ({ round, groups: round.groups.filter((g) => g.matches.some((m) => m.result)) }))
      .filter((d) => d.groups.length > 0),
  );
  let busy = $state<string | null>(null);
  let msg = $state<string | null>(null);

  const teamName = (w: string) => (w === 'A' ? event.team_a_name : w === 'B' ? event.team_b_name : 'Halved');

  async function reopen(g: GroupView) {
    const label = matchesLabel(g);
    if (!confirm(`Reopen ${label}? Its confirmed results are removed, its points go back to projected, and it reappears on the Scores tab for editing.`)) return;
    busy = g.group.id;
    msg = null;
    try {
      await must(supabase.from('match_results').delete().eq('group_id', g.group.id));
      await Promise.all([load(), loadAll()]);
      msg = `${label} reopened`;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    } finally {
      busy = null;
    }
  }
</script>

<section class="card">
  <h2>Confirmed results</h2>
  <p class="muted small">Confirmed matches are locked and drop off the Scores tab. Reopen one to correct its scores; it can then be confirmed again.</p>
  {#if msg}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

  {#each confirmed as day (day.round.round.id)}
    <h3 class="day">{day.round.round.name}</h3>
    {#each day.groups as g (g.group.id)}
      <div class="row-card" data-testid="reopen-row">
        <div class="row top">
          <strong>{matchesLabel(g)}</strong>
          <button class="secondary" disabled={busy !== null} onclick={() => reopen(g)}>{busy === g.group.id ? 'Reopening…' : 'Reopen'}</button>
        </div>
        {#each g.matches as m (m.def.id)}
          <div class="muted small">
            {m.def.type === 'better_ball' ? '' : `${matchLabel(m.def.type)}: `}{[...m.def.sideA, ...m.def.sideB].map(playerShort).join(', ')} —
            {m.result ? `${teamName(m.result.winner)} ${m.result.winner === 'halved' ? '' : m.result.resultText}` : 'not confirmed'}
          </div>
        {/each}
      </div>
    {/each}
  {:else}
    <p class="muted">{view ? 'No confirmed matches yet.' : 'Loading…'}</p>
  {/each}
</section>

<style>
  .day { font-size: 1rem; margin: 12px 0 6px; }
  .row-card { border-top: 1px solid var(--line); padding: 10px 0; }
  .top { justify-content: space-between; margin-bottom: 6px; }
</style>
