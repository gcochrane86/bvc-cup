<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, initAuth, isAdmin } from './lib/auth.svelte';
  import { router } from './lib/router.svelte';
  import { db, startData, stopData } from './lib/data/store.svelte';
  import Login from './routes/Login.svelte';
  import Leaderboard from './routes/Leaderboard.svelte';
  import AdminHome from './routes/admin/AdminHome.svelte';
  import AdminPlayers from './routes/admin/AdminPlayers.svelte';
  import AdminCourses from './routes/admin/AdminCourses.svelte';
  import AdminCourse from './routes/admin/AdminCourse.svelte';
  import Players from './routes/Players.svelte';
  import ScoreEntry from './routes/ScoreEntry.svelte';
  import Match from './routes/Match.svelte';
  import Nav from './components/Nav.svelte';

  onMount(initAuth);
  const route = $derived(router.route);
  const signedIn = $derived(!!auth.session);
  const needsAdmin = $derived(route.name.startsWith('admin') && route.name !== 'admin-login');

  $effect(() => {
    if (signedIn) {
      startData();
      return stopData;
    }
  });
</script>

{#if !auth.ready}
  <p class="center muted">Loading…</p>
{:else if route.name === 'admin-login' || (signedIn && needsAdmin && !isAdmin())}
  <Login mode="admin" />
{:else if !signedIn}
  <Login mode="trip" />
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
        {#key route.groupId}
          <ScoreEntry groupId={route.groupId} />
        {/key}
      {:else if route.name === 'players'}
        <Players />
      {:else if route.name === 'admin'}
        <AdminHome />
      {:else if route.name === 'admin-players'}
        <AdminPlayers />
      {:else if route.name === 'admin-courses'}
        <AdminCourses />
      {:else if route.name === 'admin-course'}
        {#key route.courseId}
          <AdminCourse courseId={route.courseId} />
        {/key}
      <!-- ROUTES: add new {:else if} branches above this line -->
      {:else}
        <p class="center">Page not found. <a href="#/">Back to the leaderboard</a></p>
      {/if}
    </main>
    <Nav />
  </div>
{/if}
