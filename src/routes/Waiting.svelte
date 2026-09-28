<script lang="ts">
  import { auth, logout, refreshAccess } from '../lib/auth.svelte';

  // Check every 10 s so the phone opens up as soon as the organiser approves.
  $effect(() => {
    const t = setInterval(() => void refreshAccess(), 10_000);
    return () => clearInterval(t);
  });
  let checking = $state(false);
  async function check() {
    checking = true;
    await refreshAccess();
    checking = false;
  }
</script>

<main class="waiting" data-testid="waiting">
  <img class="logo" src="./icon.svg" alt="" width="80" height="80" />
  {#if auth.access === 'removed'}
    <h1>Access removed</h1>
    <p>The organiser has removed access for <strong>{auth.session?.user?.email}</strong>. Ask them if you think this is a mistake.</p>
  {:else}
    <h1>Waiting for approval</h1>
    <p>You're logged in as <strong>{auth.session?.user?.email}</strong>. The organiser needs to approve you before you can see the scores.</p>
    <p class="muted small">This page will open up automatically once you're approved.</p>
    <button onclick={check} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
  {/if}
  <button class="secondary" onclick={logout}>Use a different email</button>
</main>

<style>
  .waiting { padding-top: 12vh; text-align: center; }
  .logo { display: block; margin: 0 auto 12px; border-radius: 20px; }
  button { width: 100%; margin-top: 10px; }
</style>
