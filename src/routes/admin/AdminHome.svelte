<script lang="ts">
  import { logout } from '../../lib/auth.svelte';
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';

  let busy = $state(false);
  let msg = $state<string | null>(null);

  async function resetScores() {
    const event = db.event;
    if (!event) return;
    const typed = prompt(
      `This deletes EVERY score and confirmed result for "${event.name}" and cannot be undone. ` +
        'Players, courses, handicaps and pairings are kept.\n\nType RESET to confirm.',
    );
    if (typed?.trim().toUpperCase() !== 'RESET') {
      if (typed !== null) msg = 'Not reset — you need to type RESET.';
      return;
    }
    busy = true;
    msg = null;
    try {
      await must(supabase.rpc('reset_event_scores', { p_event_id: event.id }));
      await loadAll();
      msg = 'All scores reset. Everything is back to the start of Day 1.';
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }
</script>

<h1>Admin</h1>
<p class="muted">Active event: <strong>{db.event?.name ?? 'none'}</strong></p>
<a class="card" href="#/admin/access">Access — approve or remove people →</a>
<a class="card" href="#/admin/events">Events, teams, rounds &amp; pairings →</a>
<a class="card" href="#/admin/results">Reopen a confirmed match →</a>
<a class="card" href="#/admin/players">Players &amp; handicaps →</a>
<a class="card" href="#/admin/courses">Courses (par &amp; stroke index) →</a>
<button class="secondary" onclick={logout}>Sign out of admin</button>
<p class="muted small">Tip: sign out and back in with the trip password to see exactly what everyone else sees.</p>

{#if db.event}
  <section class="card danger-zone">
    <h3>Reset all scores</h3>
    <p class="muted small">Clears every score and confirmed result for this event, back to the start of Day 1. Players, courses, handicaps and pairings stay as they are.</p>
    {#if msg}<p class:error={msg.startsWith('Error') || msg.startsWith('Not')}>{msg}</p>{/if}
    <button class="danger" disabled={busy} onclick={resetScores}>{busy ? 'Resetting…' : 'Reset all scores'}</button>
  </section>
{/if}

<style>
  .danger-zone { margin-top: 28px; border: 1px solid var(--danger); }
  .danger-zone h3 { color: var(--danger); margin-bottom: 4px; }
  button.danger { background: var(--danger); }
</style>
