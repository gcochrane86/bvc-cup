<script lang="ts">
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import type { EventPlayerRow, EventRow, RoundRow } from '../../lib/data/types';

  let { eventId }: { eventId: string } = $props();

  type Member = { team: '' | 'A' | 'B'; handicap: number };
  let event = $state<EventRow | null>(null);
  let members = $state<Record<string, Member>>({});
  let rounds = $state<RoundRow[]>([]);
  let msg = $state<string | null>(null);
  let newRound = $state({ name: '', course_id: '', date: '' });

  async function load() {
    const id = eventId;
    const [ev, eps, rs] = await Promise.all([
      must(supabase.from('events').select('*').eq('id', id).single()) as Promise<EventRow>,
      must(supabase.from('event_players').select('*').eq('event_id', id)) as Promise<EventPlayerRow[]>,
      must(supabase.from('rounds').select('*').eq('event_id', id).order('round_no')) as Promise<RoundRow[]>,
    ]);
    event = ev;
    rounds = rs;
    members = Object.fromEntries(
      db.players.map((p) => {
        const m = eps.find((x) => x.player_id === p.id);
        return [p.id, { team: m?.team ?? '', handicap: Number(p.default_handicap) }];
      }),
    );
  }
  $effect(() => {
    void load();
  });

  async function act(fn: () => Promise<unknown>, ok: string) {
    msg = null;
    try {
      await fn();
      await load();
      await loadAll();
      msg = ok;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    }
  }

  const countA = $derived(Object.values(members).filter((m) => m.team === 'A').length);
  const countB = $derived(Object.values(members).filter((m) => m.team === 'B').length);

  const saveDetails = () =>
    act(async () => {
      const ev = event!;
      // Only one active event is allowed (unique index): deactivate the others first.
      if (ev.is_active) await must(supabase.from('events').update({ is_active: false }).neq('id', ev.id));
      await must(
        supabase
          .from('events')
          .update({
            name: ev.name,
            team_a_name: ev.team_a_name,
            team_a_colour: ev.team_a_colour,
            team_b_name: ev.team_b_name,
            team_b_colour: ev.team_b_colour,
            is_active: ev.is_active,
          })
          .eq('id', ev.id),
      );
    }, 'Event saved');

  const saveMembers = () =>
    act(async () => {
      const entries = Object.entries(members);
      const rows = entries
        .filter(([, m]) => m.team)
        .map(([player_id, m]) => ({ event_id: eventId, player_id, team: m.team, handicap: Number(m.handicap) }));
      const removed = entries.filter(([, m]) => !m.team).map(([id]) => id);
      if (rows.length) await must(supabase.from('event_players').upsert(rows));
      if (removed.length) await must(supabase.from('event_players').delete().eq('event_id', eventId).in('player_id', removed));
    }, 'Teams saved');

  const addRound = (e: SubmitEvent) => {
    e.preventDefault();
    const next = Math.max(0, ...rounds.map((r) => r.round_no)) + 1;
    void act(
      () =>
        must(
          supabase.from('rounds').insert({
            event_id: eventId,
            round_no: next,
            name: newRound.name.trim() || `Day ${next}`,
            course_id: newRound.course_id,
            date: newRound.date || null,
          }),
        ),
      'Round added',
    ).then(() => (newRound = { name: '', course_id: '', date: '' }));
  };

  const saveRound = (r: RoundRow) =>
    act(
      () =>
        must(
          supabase
            .from('rounds')
            .update({
              name: r.name,
              course_id: r.course_id,
              date: r.date || null,
              allowance_pct: Number(r.allowance_pct),
              better_ball_points: Number(r.better_ball_points),
              singles_enabled: r.singles_enabled,
              singles_points: Number(r.singles_points),
              singles_allowance_pct: Number(r.singles_allowance_pct),
              singles_pairing: r.singles_pairing,
            })
            .eq('id', r.id),
        ).then(() =>
          // By handicap means the straight line-up for every group (random/chosen are set on the pairings page).
          r.singles_pairing === 'handicap'
            ? must(supabase.from('groups').update({ singles_crossed: false }).eq('round_id', r.id))
            : null,
        ),
      `${r.name} saved`,
    );
</script>

<p><a href="#/admin/events">← Events</a></p>
{#if msg}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

{#if event}
  <section class="card">
    <h2>Event</h2>
    <div class="field"><label for="evn">Name</label><input id="evn" bind:value={event.name} /></div>
    <div class="row">
      <div class="field"><label for="ta">Team A name</label><input id="ta" bind:value={event.team_a_name} /></div>
      <div class="field"><label for="tac">Colour</label><input id="tac" type="color" bind:value={event.team_a_colour} /></div>
    </div>
    <div class="row">
      <div class="field"><label for="tb">Team B name</label><input id="tb" bind:value={event.team_b_name} /></div>
      <div class="field"><label for="tbc">Colour</label><input id="tbc" type="color" bind:value={event.team_b_colour} /></div>
    </div>
    <label class="row"><input type="checkbox" bind:checked={event.is_active} /> Active event (shown on the leaderboard)</label>
    <button onclick={saveDetails}>Save event</button>
  </section>

  <section class="card">
    <h2>Teams</h2>
    <p class="muted small">Handicap indexes are set on the <a href="#/admin/players">Players</a> page.</p>
    <p class="muted small">{event.team_a_name}: {countA} · {event.team_b_name}: {countB} (6 each for three fourballs)</p>
    {#each db.players as p (p.id)}
      {#if members[p.id]}
        <div class="member">
          <span class="pname">{p.name}</span>
          <select aria-label="{p.name} team" bind:value={members[p.id].team}>
            <option value="">—</option>
            <option value="A">{event.team_a_name}</option>
            <option value="B">{event.team_b_name}</option>
          </select>
          <span class="hcp" aria-label="{p.name} handicap index">{members[p.id].handicap}</span>
        </div>
      {/if}
    {/each}
    <button onclick={saveMembers}>Save teams</button>
  </section>

  <section class="card">
    <h2>Rounds</h2>
    {#each rounds as r (r.id)}
      <div class="round">
        <div class="row">
          <div class="field"><label for="rn-{r.id}">Name</label><input id="rn-{r.id}" bind:value={r.name} /></div>
          <div class="field"><label for="rd-{r.id}">Date</label><input id="rd-{r.id}" type="date" bind:value={r.date} /></div>
        </div>
        <div class="field">
          <label for="rc-{r.id}">Course</label>
          <select id="rc-{r.id}" bind:value={r.course_id}>
            {#each db.courses as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
        </div>
        <div class="row">
          <div class="field"><label for="ra-{r.id}">Allowance %</label><input id="ra-{r.id}" type="number" min="0" max="100" bind:value={r.allowance_pct} /></div>
          <div class="field"><label for="rp-{r.id}">Fourball pts</label><input id="rp-{r.id}" type="number" step="0.5" bind:value={r.better_ball_points} /></div>
        </div>
        <label class="row"><input type="checkbox" bind:checked={r.singles_enabled} /> Also play 2 singles in each fourball</label>
        {#if r.singles_enabled}
          <div class="row">
            <div class="field"><label for="rsp-{r.id}">Singles pts</label><input id="rsp-{r.id}" type="number" step="0.5" bind:value={r.singles_points} /></div>
            <div class="field"><label for="rsa-{r.id}">Singles allowance %</label><input id="rsa-{r.id}" type="number" min="0" max="100" bind:value={r.singles_allowance_pct} /></div>
          </div>
          <div class="field">
            <label for="rsm-{r.id}">Singles pairings</label>
            <select id="rsm-{r.id}" bind:value={r.singles_pairing}>
              <option value="handicap">By handicap (low v low, high v high)</option>
              <option value="random">Random draw</option>
              <option value="selected">Chosen by admin</option>
            </select>
          </div>
        {/if}
        <div class="row">
          <button onclick={() => saveRound(r)}>Save round</button>
          <a href="#/admin/pairings/{r.id}">Pairings →</a>
        </div>
      </div>
    {/each}

    <form class="round" onsubmit={addRound}>
      <h3>Add round</h3>
      <div class="row">
        <div class="field"><label for="nrn">Name</label><input id="nrn" bind:value={newRound.name} placeholder="Day {rounds.length + 1}" /></div>
        <div class="field"><label for="nrd">Date</label><input id="nrd" type="date" bind:value={newRound.date} /></div>
      </div>
      <div class="field">
        <label for="nrc">Course</label>
        <select id="nrc" bind:value={newRound.course_id} required>
          <option value="" disabled>Choose a course</option>
          {#each db.courses as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <button type="submit">Add round</button>
    </form>
  </section>
{:else}
  <p class="center muted">Loading…</p>
{/if}

<style>
  section h2 { margin-bottom: 10px; }
  section button { margin-top: 8px; }
  .member { display: grid; grid-template-columns: 1fr 120px 80px; gap: 6px; align-items: center; margin-bottom: 6px; }
  .hcp { text-align: center; color: var(--muted); }
  .pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .round { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
  input[type='color'] { padding: 4px; }
</style>
