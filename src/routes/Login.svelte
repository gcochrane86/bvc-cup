<script lang="ts">
  import { watch } from '../lib/watch.svelte';
  import { login, rememberedEmail } from '../lib/auth.svelte';

  let { mode }: { mode: 'trip' | 'admin' } = $props();
  let email = $state(rememberedEmail());
  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = await login(password, mode, email);
    busy = false;
    if (!error && mode === 'admin') location.hash = '#/admin';
  }
</script>

<main class="login">
  <img class="logo" src="./icon.svg" alt="" width="96" height="96" />
  <h1>{mode === 'admin' ? 'Admin login' : 'BvC Cup'}</h1>
  {#if mode === 'trip' && watch.ended}<p class="notice-box" data-testid="link-ended">That share link has been turned off. Sign in to see the event.</p>{/if}
  <form class="card" onsubmit={submit}>
    {#if mode === 'trip'}
      <div class="field">
        <label for="em">Your email</label>
        <input id="em" type="email" autocomplete="email" inputmode="email" autocapitalize="off" bind:value={email} required />
      </div>
    {/if}
    <div class="field">
      <label for="pw">{mode === 'trip' ? 'Trip password' : 'Password'}</label>
      <input id="pw" type="password" autocomplete="current-password" bind:value={password} required />
    </div>
    {#if error}<p class="error">{error}</p>{/if}
    <button type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Enter'}</button>
    {#if mode === 'trip'}<p class="muted small note">First time? The organiser will need to approve you.</p>{/if}
  </form>
  {#if mode === 'trip'}
    <p class="muted small"><a href="#/admin/login">Admin login</a></p>
  {:else}
    <p class="muted small"><a href="#/">Back</a></p>
  {/if}
</main>

<style>
  .notice-box { background: #fff1dd; color: #9a5a12; border-radius: 10px; padding: 10px 12px; }
  .login { padding-top: 12vh; }
  .logo { display: block; margin: 0 auto 12px; border-radius: 22px; }
  h1 { text-align: center; margin-bottom: 24px; }
  button { width: 100%; }
  p { text-align: center; }
  .note { margin: 10px 0 0; }
</style>
