<script lang="ts">
  import { loadAll } from '../lib/data/store.svelte';
  import { must, supabase } from '../lib/supabase';
  import type { EventRow, RoundRow } from '../lib/data/types';

  // Clear the scores and confirmed results for one day, or the whole event. Setup is never touched.
  let { event, rounds, onDone }: { event: EventRow; rounds: RoundRow[]; onDone: () => Promise<void> } = $props();

  let which = $state('all');
  let busy = $state(false);
  let msg = $state<string | null>(null);

  const label = $derived(which === 'all' ? 'all days' : (rounds.find((r) => r.id === which)?.name ?? 'this day'));

  async function reset() {
    const typed = prompt(
      `This deletes EVERY score and confirmed result for ${label} of "${event.name}" and cannot be undone. ` +
        'Players, courses, handicaps and pairings are kept.\n\nType RESET to confirm.',
    );
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'RESET') {
      msg = 'Not reset — you need to type RESET.';
      return;
    }
    busy = true;
    msg = null;
    try {
      if (which === 'all') await must(supabase.rpc('reset_event_scores', { p_event_id: event.id }));
      else await must(supabase.rpc('reset_round_scores', { p_round_id: which }));
      await loadAll();
      await onDone();
      msg = `Scores reset for ${label}.`;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card danger-zone" data-testid="reset-scores">
  <h2>Reset scores</h2>
  <p class="muted small">Clears every score and confirmed result for the day you choose. Players, courses, handicaps and pairings stay as they are.</p>
  <div class="field">
    <label for="reset-which">Which scores?</label>
    <select id="reset-which" bind:value={which}>
      {#each rounds as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
      <option value="all">All days</option>
    </select>
  </div>
  {#if msg}<p class:error={msg.startsWith('Error') || msg.startsWith('Not')}>{msg}</p>{/if}
  <button class="danger" disabled={busy} onclick={reset}>{busy ? 'Resetting…' : `Reset ${label}`}</button>
</section>

<style>
  .danger-zone { border: 1px solid var(--danger); }
  .danger-zone h2 { color: var(--danger); margin-bottom: 4px; }
  button.danger { background: var(--danger); width: 100%; }
</style>
