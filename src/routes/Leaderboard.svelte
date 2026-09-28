<script lang="ts">
  import { db } from '../lib/data/store.svelte';
  import { buildEventView, leaderboardRoundId } from '../lib/view';
  import { readScoringGroup } from '../lib/scoringMemory';
  import { isAdmin } from '../lib/auth.svelte';
  import TeamTracker from '../components/TeamTracker.svelte';
  import ScoreBar from '../components/ScoreBar.svelte';
  import MatchCard from '../components/MatchCard.svelte';

  const view = $derived(buildEventView(db));
  let chosen = $state<string | null>(null);
  // Opens on the day of the match this phone is scoring (else the first day not yet confirmed); tapping a tab overrides it.
  const scoringGroup = readScoringGroup();
  const roundId = $derived(chosen ?? (view ? leaderboardRoundId(view, scoringGroup) : null));
  const rv = $derived(view?.rounds.find((r) => r.round.id === roundId) ?? null);

  // Full tracker card at the top; once it has scrolled up out of view, the compact bar slides in.
  let full = $state<HTMLElement>();
  let compact = $state(false);
  $effect(() => {
    if (!full) return;
    const io = new IntersectionObserver(([e]) => {
      compact = !e.isIntersecting && e.boundingClientRect.top < 0;
    });
    io.observe(full);
    return () => io.disconnect();
  });
</script>

{#if !view}
  <p class="center">
    No active event yet.
    {#if isAdmin()}<a href="#/admin/events">Set one up</a>{:else}Ask the organiser to set one up.{/if}
  </p>
{:else}
  <h1>{view.event.name}</h1>
  <div bind:this={full}>
    <TeamTracker tracker={view.tracker} event={view.event} breakdown={view.rounds.map((r) => ({ name: r.round.name, points: r.pointsAvailable }))} />
  </div>
  <ScoreBar tracker={view.tracker} event={view.event} visible={compact} />
  <div class="tabs" role="tablist">
    {#each view.rounds as r (r.round.id)}
      <button role="tab" aria-selected={r.round.id === roundId} class:active={r.round.id === roundId} onclick={() => (chosen = r.round.id)}>
        {r.round.name}
      </button>
    {/each}
  </div>
  {#if rv}
    {@const course = db.courses.find((c) => c.id === rv.round.course_id)}
    {#if course}<h2 class="course">{course.name}</h2>{/if}
    <p class="muted small">{rv.completed} of {rv.totalMatches} matches completed</p>
    {#each rv.groups as g (g.group.id)}
      {#each g.matches as mv (mv.def.id)}
        <MatchCard {mv} teeTime={g.group.tee_time} />
      {/each}
    {:else}
      <p class="muted">Pairings haven't been set for this round yet.</p>
    {/each}
  {/if}
{/if}

<style>
  .tabs { display: flex; gap: 8px; overflow-x: auto; margin: 4px 0 8px; }
  .tabs button { background: var(--surface); color: var(--text); border: 1px solid var(--line); flex: none; }
  .course { font-size: 1.05rem; margin: 4px 0 2px; }
  .course + p { margin-top: 0; }
  .tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
</style>
