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
  const remove = (p: PlayerRow) => {
    if (confirm(`Delete ${p.name}? This also deletes their scores.`)) void act(() => must(supabase.from('players').delete().eq('id', p.id)), `Deleted ${p.name}`);
  };
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Players</h1>
<p class="muted small">Enter each player's Handicap Index. Each round converts it to a course handicap using that course's slope and rating. Changes apply straight away to rounds still being played; groups with a confirmed match keep the index they played off.</p>
{#if msg}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

<form class="card" onsubmit={add}>
  <h3>Add player</h3>
  <div class="field"><label for="n">Full name</label><input id="n" bind:value={name} required /></div>
  <div class="row">
    <div class="field"><label for="s">Short name (cards)</label><input id="s" bind:value={shortName} placeholder="Surname" /></div>
    <div class="field"><label for="h">Handicap index</label><input id="h" type="number" step="0.1" inputmode="decimal" bind:value={handicap} /></div>
  </div>
  <button type="submit">Add player</button>
</form>

{#each db.players as p (p.id)}
  <div class="card" data-testid="admin-player">
    <div class="row">
      <Avatar name={p.name} url={photoUrl(p.id)} colour="var(--accent)" size={48} />
      <PhotoUpload playerId={p.id} label={p.photo_path ? 'Change photo' : 'Add photo'} />
    </div>
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
{/each}
