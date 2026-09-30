<script lang="ts">
  import { db, loadAll, photoUrl } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import type { PlayerRow } from '../../lib/data/types';
  import Avatar from '../../components/Avatar.svelte';
  import PhotoUpload from '../../components/PhotoUpload.svelte';

  let name = $state('');
  let shortName = $state('');
  let handicap = $state(0);
  let msg = $state<string | null>(null);

  async function act(fn: () => Promise<unknown>, ok: string) {
    msg = null;
    try {
      await fn();
      await loadAll();
      msg = ok;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    }
  }

  const add = (e: SubmitEvent) => {
    e.preventDefault();
    const n = name.trim();
    void act(async () => {
      await must(
        supabase.from('players').insert({ name: n, short_name: shortName.trim() || n.split(/\s+/).at(-1), default_handicap: handicap }),
      );
      name = '';
      shortName = '';
      handicap = 0;
    }, `Added ${n}`);
  };
  const save = (p: PlayerRow) =>
    act(
      async () => {
        await must(supabase.from('players').update({ name: p.name, short_name: p.short_name, default_handicap: p.default_handicap }).eq('id', p.id));
        // The active event plays off this handicap too (confirmed groups stay frozen at what they played off).
        if (db.event)
          await must(supabase.from('event_players').update({ handicap: p.default_handicap }).eq('event_id', db.event.id).eq('player_id', p.id));
      },
      `Saved ${p.name}`,
    );
  // One player open for editing at a time; the list is searchable and can show just this event's players.
  let open = $state<string | null>(null);
  let adding = $state(false);
  let search = $state('');
  let onlyEvent = $state(false);
  const inEvent = (id: string) => db.eventPlayers.some((ep) => ep.player_id === id);
  const eventCount = $derived(db.players.filter((p) => inEvent(p.id)).length);
  const shown = $derived(
    db.players.filter((p) => (!onlyEvent || inEvent(p.id)) && `${p.name} ${p.short_name}`.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const remove = (p: PlayerRow) => {
    if (confirm(`Delete ${p.name}? This also deletes their scores.`)) void act(() => must(supabase.from('players').delete().eq('id', p.id)), `Deleted ${p.name}`);
  };
</script>

<p><a href="#/admin">← Admin</a></p>
<div class="head">
  <h1>Players</h1>
  {#if !adding}<button class="secondary" onclick={() => (adding = true)}>+ Add player</button>{/if}
</div>
{#if msg}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

{#if adding}
  <form class="card" onsubmit={add}>
    <h3>Add player</h3>
    <div class="field"><label for="n">Full name</label><input id="n" bind:value={name} required /></div>
    <div class="row">
      <div class="field"><label for="s">Short name (cards)</label><input id="s" bind:value={shortName} placeholder="Surname" /></div>
      <div class="field"><label for="h">Handicap index</label><input id="h" type="number" step="0.1" inputmode="decimal" bind:value={handicap} /></div>
    </div>
    <div class="row">
      <button type="submit">Add player</button>
      <button type="button" class="secondary" onclick={() => (adding = false)}>Cancel</button>
    </div>
  </form>
{/if}

<input class="search" type="search" placeholder="Search {db.players.length} players" bind:value={search} />
{#if db.event}
  <div class="filters" role="group" aria-label="Show">
    <button class:on={!onlyEvent} onclick={() => (onlyEvent = false)}>All · {db.players.length}</button>
    <button class:on={onlyEvent} onclick={() => (onlyEvent = true)}>{db.event.name} · {eventCount}</button>
  </div>
{/if}

<div class="list">
  {#each shown as p (p.id)}
    <div class="player" class:open={open === p.id} data-testid="admin-player">
      <button class="line" aria-expanded={open === p.id} onclick={() => (open = open === p.id ? null : p.id)}>
        <Avatar name={p.name} url={photoUrl(p.id)} colour="var(--accent)" size={40} />
        <span class="who">
          <strong>{p.name}</strong>
          <span class="muted small">{p.short_name}{inEvent(p.id) ? ' · in this event' : ''}</span>
        </span>
        <span class="hi" title="Handicap index">{Number(p.default_handicap).toFixed(1)}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      {#if open === p.id}
        <div class="edit">
          <div class="photo"><PhotoUpload playerId={p.id} label={p.photo_path ? 'Change photo' : 'Add photo'} /></div>
          <div class="field"><label for="n-{p.id}">Full name</label><input id="n-{p.id}" bind:value={p.name} /></div>
          <div class="row">
            <div class="field"><label for="s-{p.id}">Short name</label><input id="s-{p.id}" bind:value={p.short_name} /></div>
            <div class="field"><label for="h-{p.id}">Handicap index</label><input id="h-{p.id}" type="number" step="0.1" inputmode="decimal" bind:value={p.default_handicap} /></div>
          </div>
          <div class="row">
            <button onclick={() => save(p)}>Save</button>
            <button class="secondary" onclick={() => remove(p)}>Delete</button>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <p class="muted center">No players match.</p>
  {/each}
</div>

<details class="about">
  <summary>How handicaps work</summary>
  <p class="muted small">Enter each player's Handicap Index. Each round converts it to a course handicap using that course's slope and rating. Changes apply straight away to rounds still being played; groups with a confirmed match keep the index they played off.</p>
</details>

<style>
  .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .head button { padding: 8px 14px; }
  .search { width: 100%; margin: 4px 0 8px; }
  .filters { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .filters button { padding: 6px 12px; border-radius: 999px; background: var(--surface); color: var(--text); border: 1px solid var(--line); font-size: 0.85rem; font-weight: 600; }
  .filters button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .list { background: var(--surface); border-radius: var(--radius); overflow: hidden; margin-bottom: 14px; }
  .player + .player { border-top: 1px solid var(--line); }
  .line { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px; background: none; color: var(--text); border: 0; border-radius: 0; text-align: left; font-weight: 400; }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .who strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hi { font-weight: 800; font-variant-numeric: tabular-nums; background: var(--bg); border-radius: 8px; padding: 4px 8px; }
  .chev { color: var(--muted); font-size: 1.4rem; transition: transform 0.15s; }
  .player.open .chev { transform: rotate(90deg); }
  .player.open { background: #f7faf7; }
  .edit { padding: 4px 14px 14px; }
  .photo { margin-bottom: 8px; }
  .about summary { color: var(--muted); font-size: 0.9rem; }
</style>
