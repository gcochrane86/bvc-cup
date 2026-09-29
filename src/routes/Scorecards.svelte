<script lang="ts">
  // The Scorecard tab: shown instead of the Leaderboard when the admin hides it for the event. Every match's
  // scorecard for a day (gross scores, shots, birdies) — but no standings (match status, summary or points).
  import { db, playerShort } from '../lib/data/store.svelte';
  import { buildEventView, leaderboardRoundId, matchesLabel, pairingLabel } from '../lib/view';
  import { readScoringGroup } from '../lib/scoringMemory';
  import { courseLabel } from '../lib/courses';
  import Scorecard from '../components/Scorecard.svelte';

  const view = $derived(buildEventView(db));
  let chosen = $state<string | null>(null);
  // Opens on the day of the match this phone is scoring (else the first day not yet confirmed).
  const scoringGroup = readScoringGroup();
  const roundId = $derived(chosen ?? (view ? leaderboardRoundId(view, scoringGroup) : null));
  const rv = $derived(view?.rounds.find((r) => r.round.id === roundId) ?? null);
</script>

<h1>Scorecard</h1>

{#if !view}
  <p class="center muted">No active event yet.</p>
{:else}
  <div class="tabs" role="tablist">
    {#each view.rounds as r (r.round.id)}
      <button role="tab" aria-selected={r.round.id === roundId} class:active={r.round.id === roundId} onclick={() => (chosen = r.round.id)}>
        {r.round.name}
      </button>
    {/each}
  </div>
  {#if rv}
    {@const course = db.courses.find((c) => c.id === rv.round.course_id)}
    {#if course}<h2 class="course">{courseLabel(course)}</h2>{/if}
    {#each rv.groups as g (g.group.id)}
      {@const fourball = g.matches.find((m) => m.def.type === 'better_ball') ?? g.matches[0]}
      {#if fourball}
        <section class="group" data-testid="scorecard-group">
          <h3>{matchesLabel(g)} <span class="muted small">· {pairingLabel(g, playerShort)}</span></h3>
          <Scorecard def={fourball.def} holes={rv.holes} scores={g.scores} teamOf={view.teamOf} playingHcp={g.playingHcp} />
        </section>
      {/if}
    {:else}
      <p class="muted">Pairings haven't been set for this round yet.</p>
    {/each}
    <p class="muted small">• = shot received on that hole. P = picked up. Red = gross birdie or better.</p>
  {/if}
{/if}

<style>
  .tabs { display: flex; gap: 8px; overflow-x: auto; margin: 4px 0 8px; }
  .tabs button { background: var(--surface); color: var(--text); border: 1px solid var(--line); flex: none; }
  .tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .course { font-size: 1.05rem; margin: 4px 0 8px; }
  .group h3 { font-size: 1rem; margin: 16px 0 6px; }
</style>
