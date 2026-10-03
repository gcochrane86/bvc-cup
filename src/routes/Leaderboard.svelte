<script lang="ts">
  import { db } from '../lib/data/store.svelte';
  import { buildEventView, leaderboardRoundId } from '../lib/view';
  import { courseLabel } from '../lib/courses';
  import { readScoringGroup } from '../lib/scoringMemory';
  import { isOrganiser } from '../lib/auth.svelte';
  import TeamTracker from '../components/TeamTracker.svelte';
  import ScoreBar from '../components/ScoreBar.svelte';
  import MatchCard from '../components/MatchCard.svelte';
  import DayTabs from '../components/DayTabs.svelte';

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
    {#if isOrganiser()}<a href="#/admin/events">Set one up</a>{:else}Ask the organiser to set one up.{/if}
  </p>
{:else}
  <h1>{view.event.name}</h1>
  <!-- Individual events have no teams, so no team tracker. -->
  {#if view.event.kind !== 'individual'}
    <div bind:this={full}>
      <TeamTracker tracker={view.tracker} event={view.event} breakdown={view.rounds.map((r) => ({ name: r.round.name, points: r.pointsAvailable }))} />
    </div>
    <ScoreBar tracker={view.tracker} event={view.event} visible={compact} />
  {/if}
  <!-- At least a screen tall, so the tracker can always scroll away and the bar appear — even on a
       day with few matches on a tall screen (the Home Screen app has no Safari bars). -->
  <div class="below">
    <DayTabs days={view.rounds.map((r) => ({ id: r.round.id, name: r.round.name }))} selected={roundId} onPick={(id) => (chosen = id)} />
    {#if rv}
      {@const course = db.courses.find((c) => c.id === rv.round.course_id)}
      {#if course}<h2 class="course">{courseLabel(course)}</h2>{/if}
      <p class="muted small">{rv.completed} of {rv.totalMatches} {view.event.kind === 'individual' ? 'games' : 'matches'} completed</p>
      {#each rv.groups as g (g.group.id)}
        {#each g.matches as mv (mv.def.id)}
          <MatchCard {mv} teeTime={g.group.tee_time} />
        {/each}
      {:else}
        <p class="muted">Pairings haven't been set for this round yet.</p>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .below { min-height: 100dvh; }
  .course { font-size: 1.05rem; margin: 4px 0 2px; }
  .course + p { margin-top: 0; }
</style>
