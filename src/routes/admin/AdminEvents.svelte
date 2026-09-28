<script lang="ts">
  import { must, supabase } from '../../lib/supabase';
  import { loadAll } from '../../lib/data/store.svelte';
  import type { EventRow } from '../../lib/data/types';
  import SwipeToDelete from '../../components/SwipeToDelete.svelte';

  let events = $state<EventRow[]>([]);
  let name = $state('');
  let error = $state<string | null>(null);
  let msg = $state<string | null>(null);

  async function load() {
    events = (await must(supabase.from('events').select('*').order('created_at', { ascending: false }))) as EventRow[];
  }
  $effect(() => {
    void load();
  });

  async function create(e: SubmitEvent) {
    e.preventDefault();
    try {
      const ev = (await must(supabase.from('events').insert({ name: name.trim() }).select().single())) as EventRow;
      location.hash = `#/admin/events/${ev.id}`;
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function remove(ev: EventRow) {
    const warning = ev.is_active
      ? `"${ev.name}" is the ACTIVE event — the leaderboard will show no event until you make another one active.\n\n`
      : '';
    if (
      !confirm(
        `${warning}Delete "${ev.name}"? This permanently deletes its rounds, pairings, scores and results. ` +
          'Players and courses are kept. This cannot be undone.',
      )
    )
      return;
    msg = null;
    error = null;
    try {
      await must(supabase.from('events').delete().eq('id', ev.id));
      await load();
      await loadAll();
      msg = `Deleted "${ev.name}"`;
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Events</h1>
<form class="card" onsubmit={create}>
  <div class="field"><label for="en">New event name</label><input id="en" bind:value={name} required placeholder="Portugal 2026" /></div>
  <button type="submit">Create event</button>
</form>
{#if error}<p class="error">{error}</p>{/if}
{#if msg}<p>{msg}</p>{/if}
{#if events.length}<p class="muted small">Swipe an event left to delete it.</p>{/if}
{#each events as ev (ev.id)}
  <SwipeToDelete label={ev.name} onDelete={() => remove(ev)}>
    <a class="card" href="#/admin/events/{ev.id}">
      <strong>{ev.name}</strong>
      {#if ev.is_active}<span class="muted small"> · ACTIVE</span>{/if}
    </a>
  </SwipeToDelete>
{/each}
