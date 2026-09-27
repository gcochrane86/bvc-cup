<script lang="ts">
  import { login } from '../lib/auth.svelte';

  let { mode }: { mode: 'trip' | 'admin' } = $props();
  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = await login(password, mode);
    busy = false;
    if (!error && mode === 'admin') location.hash = '#/admin';
  }
</script>

<main class="login">
  <img class="logo" src="./icon.svg" alt="" width="96" height="96" />
  <h1>{mode === 'admin' ? 'Admin login' : 'BvC Cup'}</h1>
  <form class="card" onsubmit={submit}>
    <div class="field">
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" bind:value={password} required />
    </div>
    {#if error}<p class="error">{error}</p>{/if}
    <button type="submit" disabled={busy}>Enter</button>
  </form>
  {#if mode === 'trip'}
    <p class="muted small"><a href="#/admin/login">Admin login</a></p>
  {:else}
    <p class="muted small"><a href="#/">Back</a></p>
  {/if}
</main>

<style>
  .login { padding-top: 15vh; }
  .logo { display: block; margin: 0 auto 12px; border-radius: 22px; }
  h1 { text-align: center; margin-bottom: 24px; }
  button { width: 100%; }
  p { text-align: center; }
</style>
