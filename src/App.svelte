<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, initAuth, isAdmin } from './lib/auth.svelte';
  import { router } from './lib/router.svelte';
  import { startWatching, watch } from './lib/watch.svelte';
  import { db, leaderboardShown, startData, stopData } from './lib/data/store.svelte';
  import Login from './routes/Login.svelte';
  import Leaderboard from './routes/Leaderboard.svelte';
  import Guide from './routes/Guide.svelte';
  import Form from './routes/Form.svelte';
  import Scorecards from './routes/Scorecards.svelte';
  import AdminEvents from './routes/admin/AdminEvents.svelte';
  import AdminEvent from './routes/admin/AdminEvent.svelte';
  import AdminPairings from './routes/admin/AdminPairings.svelte';
  import AdminHome from './routes/admin/AdminHome.svelte';
  import AdminPlayers from './routes/admin/AdminPlayers.svelte';
  import AdminAccess from './routes/admin/AdminAccess.svelte';
  import Waiting from './routes/Waiting.svelte';
  import AdminCourses from './routes/admin/AdminCourses.svelte';
  import AdminCourse from './routes/admin/AdminCourse.svelte';
  import AdminGuide from './routes/admin/AdminGuide.svelte';
  import ScoreEntry from './routes/ScoreEntry.svelte';
  import Match from './routes/Match.svelte';
  import Nav from './components/Nav.svelte';

  onMount(initAuth);
  const route = $derived(router.route);
  const signedIn = $derived(!!auth.session);
  const needsAdmin = $derived(route.name.startsWith('admin') && route.name !== 'admin-login');

  // Only people the admin has approved get the app (the database enforces this too).
  const approved = $derived(auth.access === 'approved');

  // Someone with an event's share link (and no approved sign-in) uses that event through the link:
  // following and scoring, like a signed-in player (nothing admin).
  const watching = $derived(!!watch.token && (!signedIn || (auth.access !== 'unknown' && !approved)));
  $effect(() => {
    if (route.name === 'watch') {
      startWatching(route.token);
      location.replace('#/');
    }
  });

  // With the Leaderboard hidden for this event, players (not the admin) go to Scores instead.
  $effect(() => {
    if (db.loaded && !leaderboardShown() && (route.name === 'home' || route.name === 'match'))
      location.replace('#/score');
  });
  $effect(() => {
    if (signedIn && approved) {
      startData();
      return stopData;
    }
    if (watching) {
      startData('watch');
      return stopData;
    }
  });
</script>

{#if !auth.ready}
  <p class="center muted">Loading…</p>
{:else if route.name === 'admin-login' || (signedIn && needsAdmin && !isAdmin())}
  <Login mode="admin" />
{:else if route.name === 'watch'}
  <p class="center muted">Loading…</p>
{:else if watching && !needsAdmin}
  <div class="app" style="--team-a:{db.event?.team_a_colour ?? '#1f4e9c'};--team-b:{db.event?.team_b_colour ?? '#c8102e'}">
    <p class="watching" data-testid="watching">{db.event?.name ?? 'Event'} · via share link</p>
    {#if db.notice}
      <button class="notice" onclick={() => (db.notice = null)}>{db.notice} (tap to dismiss)</button>
    {/if}
    {#if db.error}<p class="notice error">Connection problem: {db.error}</p>{/if}
    <main>
      {#if !db.loaded}
        <p class="center muted">Loading…</p>
      {:else if route.name === 'home'}
        <Leaderboard />
      {:else if route.name === 'match'}
        {#key route.groupId + route.matchType}
          <Match groupId={route.groupId} matchType={route.matchType} />
        {/key}
      {:else if route.name === 'score'}
        {#key `${route.groupId}:${route.hole}`}
          <ScoreEntry groupId={route.groupId} startHole={route.hole} />
        {/key}
      {:else if route.name === 'guide'}
        <Guide />
      {:else if route.name === 'scorecards'}
        <Scorecards />
      {:else if route.name === 'form' && db.event?.show_form}
        <Form />
      {:else}
        <p class="center">Page not found. <a href="#/">Back to the leaderboard</a></p>
      {/if}
    </main>
    <Nav />
  </div>
{:else if !signedIn}
  <Login mode="trip" />
{:else if auth.access === 'unknown'}
  <p class="center muted">Loading…</p>
{:else if !approved}
  <Waiting />
{:else}
  <div class="app" style="--team-a:{db.event?.team_a_colour ?? '#1f4e9c'};--team-b:{db.event?.team_b_colour ?? '#c8102e'}">
    {#if db.notice}
      <button class="notice" onclick={() => (db.notice = null)}>{db.notice} (tap to dismiss)</button>
    {/if}
    {#if db.error}<p class="notice error">Connection problem: {db.error}</p>{/if}
    <main>
      {#if !db.loaded}
        <p class="center muted">Loading…</p>
      {:else if route.name === 'home'}
        <Leaderboard />
      {:else if route.name === 'match'}
        {#key route.groupId + route.matchType}
          <Match groupId={route.groupId} matchType={route.matchType} />
        {/key}
      {:else if route.name === 'score'}
        {#key `${route.groupId}:${route.hole}`}
          <ScoreEntry groupId={route.groupId} startHole={route.hole} />
        {/key}
      {:else if route.name === 'admin'}
        <AdminHome />
      {:else if route.name === 'admin-players'}
        <AdminPlayers />
      {:else if route.name === 'admin-access'}
        <AdminAccess />
      {:else if route.name === 'admin-courses'}
        <AdminCourses />
      {:else if route.name === 'admin-guide'}
        {#key route.courseId}<AdminGuide courseId={route.courseId} />{/key}
      {:else if route.name === 'admin-course'}
        {#key `${route.courseId}:${route.copyFrom}`}
          <AdminCourse courseId={route.courseId} copyFrom={route.copyFrom} />
        {/key}
      {:else if route.name === 'admin-events'}
        <AdminEvents />
      {:else if route.name === 'admin-event'}
        {#key route.eventId}
          <AdminEvent eventId={route.eventId} />
        {/key}
      {:else if route.name === 'admin-pairings'}
        {#key route.roundId}
          <AdminPairings roundId={route.roundId} />
        {/key}
      {:else if route.name === 'guide'}
        <Guide />
      {:else if route.name === 'scorecards'}
        <Scorecards />
      {:else if route.name === 'form' && db.event?.show_form}
        <Form />
      <!-- ROUTES: add new {:else if} branches above this line -->
      {:else}
        <p class="center">Page not found. <a href="#/">Back to the leaderboard</a></p>
      {/if}
    </main>
    <Nav />
  </div>
{/if}

<style>
  .watching { margin: 0; padding: 8px 16px; background: var(--accent); color: #fff; font-size: 0.85rem; text-align: center; }
</style>
