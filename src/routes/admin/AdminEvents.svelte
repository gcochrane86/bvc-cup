<script lang="ts">
  import { must, supabase } from '../../lib/supabase';
  import { db, loadAll } from '../../lib/data/store.svelte';
  import type { EventRow } from '../../lib/data/types';
  import SwipeToDelete from '../../components/SwipeToDelete.svelte';

  let events = $state<EventRow[]>([]);
  let rounds = $state<{ event_id: string; course_id: string }[]>([]);
  let entries = $state<{ event_id: string }[]>([]);
  let name = $state('');
  let adding = $state(false);
  let error = $state<string | null>(null);
  let msg = $state<string | null>(null);

  async function load() {
    [events, rounds, entries] = await Promise.all([
      must(supabase.from('events').select('*').order('created_at', { ascending: false })) as Promise<EventRow[]>,
      must(supabase.from('rounds').select('event_id, course_id').order('round_no')) as Promise<{ event_id: string; course_id: string }[]>,
      must(supabase.from('event_players').select('event_id')) as Promise<{ event_id: string }[]>,
    ]);
  }
  $effect(() => {
    void load();
  });

  // Active first, then newest.
  const sorted = $derived([...events].sort((a, b) => Number(b.is_active) - Number(a.is_active)));

  /** e.g. "1 day · Galgorm Castle · 24 players". */
  function summary(ev: EventRow): string {
    const days = rounds.filter((r) => r.event_id === ev.id);
    const players = entries.filter((e) => e.event_id === ev.id).length;
    const courses = [...new Set(days.map((r) => db.courses.find((c) => c.id === r.course_id)?.name).filter(Boolean))];
    const parts = [
      days.length ? `${days.length} day${days.length === 1 ? '' : 's'}` : 'No days yet',
      courses.length > 2 ? `${courses.length} courses` : courses.join(', '),
      `${players} player${players === 1 ? '' : 's'}`,
    ];
    return parts.filter(Boolean).join(' · ');
  }

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
<div class="head">
  <h1>Events</h1>
  {#if !adding && events.length}<button class="secondary" onclick={() => (adding = true)}>+ New event</button>{/if}
</div>
{#if adding || !events.length}
  <form class="card" onsubmit={create}>
    <div class="field"><label for="en">New event name</label><input id="en" bind:value={name} required placeholder="Portugal 2026" /></div>
    <div class="actions">
      <button type="submit">Create event</button>
      {#if events.length}<button type="button" class="secondary" onclick={() => (adding = false)}>Cancel</button>{/if}
    </div>
  </form>
{/if}
{#if error}<p class="error">{error}</p>{/if}
{#if msg}<p>{msg}</p>{/if}
{#each sorted as ev (ev.id)}
  <SwipeToDelete label={ev.name} onDelete={() => remove(ev)}>
    <a class="tile" class:active={ev.is_active} href="#/admin/events/{ev.id}">
      <span class="name"><strong>{ev.name}</strong>{#if ev.is_active}<span class="pill">Active</span>{/if}</span>
      <span class="sub">{summary(ev)}</span>
      <span class="arrow" aria-hidden="true">›</span>
    </a>
  </SwipeToDelete>
{/each}
{#if events.length}<p class="muted small hint">Swipe an event left to delete it.</p>{/if}

<style>
  .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .head button { padding: 8px 14px; }
  .actions { display: flex; gap: 8px; }
  .tile { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 16px 40px 16px 16px; margin-bottom: 10px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); color: var(--text); text-decoration: none; }
  .tile .name { display: flex; align-items: center; gap: 8px; font-size: 1.05rem; }
  .tile .sub { color: var(--muted); font-size: 0.85rem; }
  .tile .arrow { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); font-size: 1.6rem; color: var(--muted); }
  .tile.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .tile.active .sub, .tile.active .arrow { color: rgba(255, 255, 255, 0.85); }
  .pill { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.2); }
  .hint { text-align: center; }
</style>
