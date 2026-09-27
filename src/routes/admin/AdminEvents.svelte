<script lang="ts">
  import { must, supabase } from '../../lib/supabase';
  import type { EventRow } from '../../lib/data/types';

  let events = $state<EventRow[]>([]);
  let name = $state('');
  let error = $state<string | null>(null);

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
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Events</h1>
<form class="card" onsubmit={create}>
  <div class="field"><label for="en">New event name</label><input id="en" bind:value={name} required placeholder="Portugal 2026" /></div>
  {#if error}<p class="error">{error}</p>{/if}
  <button type="submit">Create event</button>
</form>
{#each events as ev (ev.id)}
  <a class="card" href="#/admin/events/{ev.id}">
    <strong>{ev.name}</strong>
    {#if ev.is_active}<span class="muted small"> · ACTIVE</span>{/if}
  </a>
{/each}
