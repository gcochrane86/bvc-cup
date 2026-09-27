<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, initAuth, isAdmin, logout } from './lib/auth.svelte';
  import { router } from './lib/router.svelte';
  import Login from './routes/Login.svelte';
  import Nav from './components/Nav.svelte';

  onMount(initAuth);
  const route = $derived(router.route);
  const signedIn = $derived(!!auth.session);
  const needsAdmin = $derived(route.name.startsWith('admin') && route.name !== 'admin-login');
</script>

{#if !auth.ready}
  <p class="center muted">Loading…</p>
{:else if route.name === 'admin-login' || (signedIn && needsAdmin && !isAdmin())}
  <Login mode="admin" />
{:else if !signedIn}
  <Login mode="trip" />
{:else}
  <main>
    <h1>Signed in{isAdmin() ? ' (admin)' : ''}</h1>
    <button class="secondary" onclick={logout}>Sign out</button>
  </main>
  <Nav />
{/if}
