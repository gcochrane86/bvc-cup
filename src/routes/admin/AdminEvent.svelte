<script lang="ts">
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import type { EventPlayerRow, EventRow, RoundRow, RoundTeeRow } from '../../lib/data/types';
  import { courseGroups, courseLabel, teesOf } from '../../lib/courses';
  import { autoFourball } from '../../lib/scoring';
  import ResetScores from '../../components/ResetScores.svelte';
  import ConfirmedResults from '../../components/ConfirmedResults.svelte';

  let { eventId }: { eventId: string } = $props();

  type Member = { team: '' | 'A' | 'B'; handicap: number };
  let event = $state<EventRow | null>(null);
  let members = $state<Record<string, Member>>({});
  let rounds = $state<RoundRow[]>([]);
  let msg = $state<string | null>(null);
  let newRound = $state({ name: '', course_id: '', date: '' });
  let roundTees = $state<RoundTeeRow[]>([]);
  /** `${roundId}:${playerId}` for players whose match that day is confirmed (their tee is locked). */
  let locked = $state<Set<string>>(new Set());

  const courseName = (id: string) => db.courses.find((c) => c.id === id)?.name ?? '';
  const teeOfPlayer = (roundId: string, pid: string) => roundTees.find((t) => t.round_id === roundId && t.player_id === pid)?.course_id ?? '';
  const lockedIn = (roundId: string, pid: string) => locked.has(`${roundId}:${pid}`);
  const setPlayerTee = (r: RoundRow, pid: string, courseId: string) => {
    const name = db.players.find((p) => p.id === pid)?.name ?? 'Player';
    const tee = db.courses.find((c) => c.id === (courseId || r.course_id))?.tee ?? 'main';
    return act(
      () =>
        courseId
          ? must(supabase.from('round_tees').upsert({ round_id: r.id, player_id: pid, course_id: courseId }))
          : must(supabase.from('round_tees').delete().eq('round_id', r.id).eq('player_id', pid)),
      `${name} plays the ${tee} tees on ${r.name}`,
    );
  };

  async function load() {
    const id = eventId;
    const [ev, eps, rs] = await Promise.all([
      must(supabase.from('events').select('*').eq('id', id).single()) as Promise<EventRow>,
      must(supabase.from('event_players').select('*').eq('event_id', id)) as Promise<EventPlayerRow[]>,
      must(supabase.from('rounds').select('*').eq('event_id', id).order('round_no')) as Promise<RoundRow[]>,
    ]);
    event = ev;
    rounds = rs;
    const ids = rs.map((r) => r.id);
    if (ids.length) {
      const [tees, gs] = await Promise.all([
        must(supabase.from('round_tees').select('*').in('round_id', ids)) as Promise<RoundTeeRow[]>,
        must(supabase.from('groups').select('round_id, group_players(player_id), match_results(match_type)').in('round_id', ids)) as Promise<
          { round_id: string; group_players: { player_id: string }[]; match_results: unknown[] }[]
        >,
      ]);
      roundTees = tees;
      locked = new Set(gs.filter((g) => g.match_results.length).flatMap((g) => g.group_players.map((gp) => `${g.round_id}:${gp.player_id}`)));
    }
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

  /** fn may return a fuller message to show instead of ok. */
  async function act(fn: () => Promise<unknown>, ok: string) {
    msg = null;
    try {
      const said = await fn();
      await load();
      await loadAll();
      msg = typeof said === 'string' ? said : ok;
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
            show_form: ev.show_form,
            show_leaderboard: ev.show_leaderboard,
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
      const paired = await pairTwoVTwo(rounds);
      return paired.length ? `Teams saved · pairings set for ${paired.join(', ')}` : 'Teams saved';
    }, 'Teams saved');

  /**
   * Two players a side means only one possible fourball, so pair it on every day (the pairing then follows any
   * change of teams). Days whose match is confirmed are left alone. Returns the names of the days paired.
   */
  async function pairTwoVTwo(days: RoundRow[]): Promise<string[]> {
    const slots = autoFourball(
      Object.entries(members)
        .filter(([, m]) => m.team)
        .map(([playerId, m]) => ({ playerId, team: m.team as 'A' | 'B', handicap: Number(m.handicap) })),
    );
    if (!slots) return [];
    const paired: string[] = [];
    for (const r of days) {
      const [g] = (await must(
        supabase.from('groups').select('tee_time, match_results(match_type)').eq('round_id', r.id).eq('group_no', 1),
      )) as { tee_time: string | null; match_results: unknown[] }[];
      if (g?.match_results.length) continue;
      await must(supabase.rpc('save_group', { p_round_id: r.id, p_group_no: 1, p_tee_time: g?.tee_time ?? null, p_slots: slots }));
      paired.push(r.name);
    }
    return paired;
  }

  const addRound = (e: SubmitEvent) => {
    e.preventDefault();
    const next = Math.max(0, ...rounds.map((r) => r.round_no)) + 1;
    void act(async () => {
      const added = (await must(
        supabase
          .from('rounds')
          .insert({
            event_id: eventId,
            round_no: next,
            name: newRound.name.trim() || `Day ${next}`,
            course_id: newRound.course_id,
            date: newRound.date || null,
          })
          .select()
          .single(),
      )) as RoundRow;
      const paired = await pairTwoVTwo([added]);
      return paired.length ? `Round added · pairings set for ${added.name}` : 'Round added';
    }, 'Round added').then(() => (newRound = { name: '', course_id: '', date: '' }));
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
              fourball_format: r.fourball_format,
            })
            .eq('id', r.id),
        ).then(async () => {
          // A different course: players' tees from the old course no longer apply.
          const tees = teesOf(db.courses, courseName(r.course_id)).map((t) => t.id);
          await must(supabase.from('round_tees').delete().eq('round_id', r.id).not('course_id', 'in', `(${tees.join(',')})`));
          // By handicap means the straight line-up for every group (random/chosen are set on the pairings page).
          if (r.singles_pairing === 'handicap') await must(supabase.from('groups').update({ singles_crossed: false }).eq('round_id', r.id));
        }),
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
    <p class="muted small">
      {event.team_a_name}: {countA} · {event.team_b_name}: {countB}
      {countA === 2 && countB === 2 ? '(one fourball: paired automatically)' : '(6 each for three fourballs)'}
    </p>
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
          <select id="rc-{r.id}" value={courseName(r.course_id)} onchange={(e) => (r.course_id = teesOf(db.courses, (e.currentTarget as HTMLSelectElement).value)[0].id)}>
            {#each courseGroups(db.courses) as g (g.name)}<option value={g.name}>{g.name}</option>{/each}
          </select>
        </div>
        {#if teesOf(db.courses, courseName(r.course_id)).some((t) => t.tee)}
          <div class="field">
            <label for="rt-{r.id}">Tees</label>
            <select id="rt-{r.id}" bind:value={r.course_id}>
              {#each teesOf(db.courses, courseName(r.course_id)) as t (t.id)}<option value={t.id}>{t.tee ?? 'Main'} tees</option>{/each}
            </select>
          </div>
          <details class="player-tees">
            <summary>Players on different tees</summary>
            <p class="muted small">Everyone plays the tees above unless picked here. Save the round first if you changed its course or tees.</p>
            {#each Object.entries(members).filter(([, m]) => m.team) as [pid] (pid)}
              {@const p = db.players.find((x) => x.id === pid)}
              <div class="member">
                <span class="pname">{p?.name}</span>
                <select
                  aria-label="{p?.name} tee on {r.name}"
                  value={teeOfPlayer(r.id, pid)}
                  disabled={lockedIn(r.id, pid)}
                  onchange={(e) => setPlayerTee(r, pid, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">Main tee</option>
                  {#each teesOf(db.courses, courseName(r.course_id)).filter((t) => t.id !== r.course_id) as t (t.id)}<option value={t.id}>{t.tee} tees</option>{/each}
                </select>
              </div>
            {/each}
          </details>
        {/if}
        <div class="field">
          <label for="rf-{r.id}">Fourball game</label>
          <select id="rf-{r.id}" bind:value={r.fourball_format}>
            <option value="matchplay">Match play (off the low)</option>
            <option value="stableford">Stableford (full handicaps)</option>
            <option value="flat">Match play, flat (no shots)</option>
            <option value="scramble">2-man scramble (35% each)</option>
          </select>
        </div>
        <div class="row">
          <!-- Stableford plays off full course handicaps and flat has no shots, so the allowance doesn't apply. -->
          {#if r.fourball_format === 'matchplay'}
            <div class="field"><label for="ra-{r.id}">Allowance %</label><input id="ra-{r.id}" type="number" min="0" max="100" bind:value={r.allowance_pct} /></div>
          {/if}
          <div class="field"><label for="rp-{r.id}">Fourball pts</label><input id="rp-{r.id}" type="number" step="0.5" bind:value={r.better_ball_points} /></div>
        </div>
        <!-- A scramble is one ball per team, so there are no singles that day. -->
        {#if r.fourball_format !== 'scramble'}
          <label class="row"><input type="checkbox" bind:checked={r.singles_enabled} /> Also play 2 singles in each fourball</label>
        {/if}
        {#if r.singles_enabled && r.fourball_format !== 'scramble'}
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
          {#each courseGroups(db.courses).flatMap((g) => g.tees) as c (c.id)}<option value={c.id}>{courseLabel(c)}</option>{/each}
        </select>
      </div>
      <button type="submit">Add round</button>
    </form>
  </section>

  <!-- Occasional settings, kept out of the way of setting up the event. -->
  <details class="more">
    <summary>More options</summary>
    <section class="card">
      <h2>Tabs for players</h2>
      <label class="row"><input type="checkbox" bind:checked={event.show_leaderboard} /> Show the Leaderboard tab to players (off: they go straight to Scores)</label>
      <label class="row"><input type="checkbox" bind:checked={event.show_form} /> Show the Form tab to players (rankings by gross, net, points, birdies…)</label>
      <button onclick={saveDetails}>Save tab settings</button>
    </section>
    {#key event.id}<ConfirmedResults {event} />{/key}
    {#if rounds.length}
      <ResetScores {event} {rounds} onDone={load} />
    {/if}
  </details>
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
  .player-tees summary { cursor: pointer; font-weight: 600; margin: 4px 0 8px; }
  .more summary { cursor: pointer; font-weight: 700; padding: 12px 0; color: var(--muted); }
  input[type='color'] { padding: 4px; }
</style>
