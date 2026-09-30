<script lang="ts">
  import ShareLink from '../../components/ShareLink.svelte';
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import type { EventPlayerRow, EventRow, RoundRow, RoundTeeRow } from '../../lib/data/types';
  import { courseGroups, teesOf } from '../../lib/courses';
  import { autoFourball } from '../../lib/scoring';
  import ResetScores from '../../components/ResetScores.svelte';
  import ConfirmedResults from '../../components/ConfirmedResults.svelte';

  let { eventId }: { eventId: string } = $props();

  /** playing: ticked in step 1; team: picked in step 2 (only saved once every player playing has one). */
  type Member = { playing: boolean; team: '' | 'A' | 'B'; handicap: number };
  let event = $state<EventRow | null>(null);
  let members = $state<Record<string, Member>>({});
  let rounds = $state<RoundRow[]>([]);
  let msg = $state<string | null>(null);
  // course: the course name picked first; course_id: its tee (the longest tee until another is picked).
  let newRound = $state({ name: '', course: '', course_id: '', date: '' });
  /** The Add round form only shows after '+ Add round' is pressed (always for an event with no rounds yet). */
  let adding = $state(false);
  let roundTees = $state<RoundTeeRow[]>([]);
  let paired = $state<Record<string, number>>({});
  /** After saving teams: a day whose pairings still need setting (scores and the leaderboard need them). */
  let nudge = $state<RoundRow | null>(null);
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
    if (!rs.length) adding = true; // a new event: straight to adding its first day
    const ids = rs.map((r) => r.id);
    if (ids.length) {
      const [tees, gs] = await Promise.all([
        must(supabase.from('round_tees').select('*').in('round_id', ids)) as Promise<RoundTeeRow[]>,
        must(supabase.from('groups').select('round_id, group_players(player_id), match_results(match_type)').in('round_id', ids)) as Promise<
          { round_id: string; group_players: { player_id: string }[]; match_results: unknown[] }[]
        >,
      ]);
      roundTees = tees;
      // Fourballs with all four players, per day (for each day's pairing status).
      paired = Object.fromEntries(ids.map((id) => [id, gs.filter((g) => g.round_id === id && g.group_players.length === 4).length]));
      locked = new Set(gs.filter((g) => g.match_results.length).flatMap((g) => g.group_players.map((gp) => `${g.round_id}:${gp.player_id}`)));
    }
    members = Object.fromEntries(
      db.players.map((p) => {
        const m = eps.find((x) => x.player_id === p.id);
        return [p.id, { playing: !!m, team: m?.team ?? '', handicap: Number(p.default_handicap) }];
      }),
    );
    if (!Object.values(members).some((m) => m.playing)) teamStep = 'who';
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

  // Step 1 (who's playing, with search) and step 2 (a one-tap team switch for each of them).
  let teamStep = $state<'who' | 'teams'>('teams');
  let search = $state('');
  const playingIds = $derived(db.players.filter((p) => members[p.id]?.playing).map((p) => p.id));
  const savedPlaying = $derived(playingIds.filter((id) => members[id].team).length);
  const fourballs = $derived(Math.floor(savedPlaying / 4));
  const pairingStatus = (r: RoundRow) => {
    const done = paired[r.id] ?? 0;
    if (fourballs > 0 && done >= fourballs) return 'Pairings set ✓';
    if (done > 0) return `${done} of ${fourballs} fourballs paired`;
    return 'Pairings not set yet';
  };
  const shown = $derived(db.players.filter((p) => members[p.id] && p.name.toLowerCase().includes(search.trim().toLowerCase())));
  const onTeam = (t: 'A' | 'B') => playingIds.filter((id) => members[id].team === t);
  const countA = $derived(onTeam('A').length);
  const countB = $derived(onTeam('B').length);
  const unassigned = $derived(playingIds.filter((id) => !members[id].team));
  const avg = (ids: string[]) => (ids.length ? (ids.reduce((sum, id) => sum + Number(members[id].handicap), 0) / ids.length).toFixed(1) : '–');
  const setAll = (on: boolean) => {
    for (const m of Object.values(members)) m.playing = on;
  };

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

  const saveMembers = async () => {
    await saveTeams();
    // More than one fourball can't be paired automatically: point at any day still needing pairings.
    if (!msg?.startsWith('Error') && savedPlaying > 4) nudge = rounds.find((r) => (paired[r.id] ?? 0) < fourballs) ?? null;
  };
  const saveTeams = () =>
    act(async () => {
      const entries = Object.entries(members);
      const rows = entries
        .filter(([, m]) => m.playing && m.team)
        .map(([player_id, m]) => ({ event_id: eventId, player_id, team: m.team, handicap: Number(m.handicap) }));
      const removed = entries.filter(([, m]) => !m.playing || !m.team).map(([id]) => id);
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
        .filter(([, m]) => m.playing && m.team)
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
    }, 'Round added').then(() => {
      newRound = { name: '', course: '', course_id: '', date: '' };
      adding = false;
    });
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

  <ShareLink {event} />

  <section class="card">
    <h2>Players</h2>
    <div class="steps" role="tablist">
      <button role="tab" aria-selected={teamStep === 'who'} class:on={teamStep === 'who'} onclick={() => (teamStep = 'who')}>
        1 · Who's playing{teamStep === 'teams' && playingIds.length ? ' ✓' : ''}
      </button>
      <button role="tab" aria-selected={teamStep === 'teams'} class:on={teamStep === 'teams'} onclick={() => (teamStep = 'teams')}>2 · Teams</button>
    </div>

    {#if teamStep === 'who'}
      <p class="muted small">Tick everyone taking part. Handicap indexes are set on the <a href="#/admin/players">Players</a> page.</p>
      <input class="search" type="search" placeholder="Search players" bind:value={search} />
      <div class="pickbar">
        <strong>{playingIds.length} of {db.players.length} playing</strong>
        <span><button class="linkbtn" onclick={() => setAll(true)}>Select all</button><button class="linkbtn" onclick={() => setAll(false)}>Clear</button></span>
      </div>
      <div class="picklist">
        {#each shown as p (p.id)}
          <label class="pick" class:sel={members[p.id].playing} data-testid="pick-row">
            <input type="checkbox" aria-label="{p.name} playing" bind:checked={members[p.id].playing} />
            <span class="pname">{p.name}</span>
            <span class="hcp">{members[p.id].handicap}</span>
          </label>
        {:else}
          <p class="muted small">No players match “{search}”.</p>
        {/each}
      </div>
      <button class="wide" disabled={!playingIds.length} onclick={() => ((teamStep = 'teams'), (search = ''))}>Next: pick teams ({playingIds.length}) →</button>
    {:else}
      <div class="totals">
        <div class="tot" style="background:{event.team_a_colour}" data-testid="team-count-A"><span>{event.team_a_name}</span><strong>{countA}</strong><span>avg index {avg(onTeam('A'))}</span></div>
        <div class="tot" style="background:{event.team_b_colour}" data-testid="team-count-B"><span>{event.team_b_name}</span><strong>{countB}</strong><span>avg index {avg(onTeam('B'))}</span></div>
      </div>
      {#if countA === 2 && countB === 2}<p class="muted small">One fourball: it's paired automatically when you save.</p>{/if}
      {#if unassigned.length}<p class="warn">{unassigned.length} {unassigned.length === 1 ? 'player' : 'players'} not on a team yet</p>{/if}
      {#if !playingIds.length}<p class="muted">Nobody's playing yet — tick players in step 1.</p>{/if}
      {#each [...unassigned, ...onTeam('A'), ...onTeam('B')] as id (id)}
        {@const p = db.players.find((x) => x.id === id)}
        <div class="teamrow">
          <span class="pname">{p?.name}<br /><span class="hcp small">{members[id].handicap}</span></span>
          <span class="seg">
            <button aria-label="{p?.name}: {event.team_a_name}" aria-pressed={members[id].team === 'A'} style={members[id].team === 'A' ? `background:${event.team_a_colour};color:#fff` : ''} onclick={() => (members[id].team = 'A')}>{event.team_a_name}</button>
            <button aria-label="{p?.name}: {event.team_b_name}" aria-pressed={members[id].team === 'B'} style={members[id].team === 'B' ? `background:${event.team_b_colour};color:#fff` : ''} onclick={() => (members[id].team = 'B')}>{event.team_b_name}</button>
          </span>
        </div>
      {/each}
      <button class="wide" disabled={unassigned.length > 0} onclick={saveMembers}>Save teams</button>
    {/if}
  </section>

  <section class="card">
    <div class="rhead">
      <h2>Rounds</h2>
      {#if !adding}<button class="addbtn" onclick={() => (adding = true)}>+ Add round</button>{/if}
    </div>
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
            {#each Object.entries(members).filter(([, m]) => m.playing && m.team) as [pid] (pid)}
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
        <button onclick={() => saveRound(r)}>Save round</button>
        <!-- Pairings: who plays with whom in each fourball (scores and the leaderboard need them). -->
        <div class="pairing">
          <a class="pairbtn" href="#/admin/pairings/{r.id}">Set pairings →</a>
          <span class="pstatus" class:ok={pairingStatus(r).endsWith('✓')} data-testid="pairing-status">{pairingStatus(r)}</span>
        </div>
      </div>
    {/each}

    {#if adding}
    <form class="round" onsubmit={addRound}>
      <h3>Add round</h3>
      <div class="row">
        <div class="field"><label for="nrn">Name</label><input id="nrn" bind:value={newRound.name} placeholder="Day {rounds.length + 1}" /></div>
        <div class="field"><label for="nrd">Date</label><input id="nrd" type="date" bind:value={newRound.date} /></div>
      </div>
      <div class="field">
        <label for="nrc">Course</label>
        <select
          id="nrc"
          value={newRound.course}
          required
          onchange={(e) => {
            newRound.course = (e.currentTarget as HTMLSelectElement).value;
            newRound.course_id = teesOf(db.courses, newRound.course)[0]?.id ?? '';
          }}
        >
          <option value="" disabled>Choose a course</option>
          {#each courseGroups(db.courses) as g (g.name)}<option value={g.name}>{g.name}</option>{/each}
        </select>
      </div>
      {#if teesOf(db.courses, newRound.course).some((t) => t.tee)}
        <div class="field">
          <label for="nrt">Tees</label>
          <select id="nrt" bind:value={newRound.course_id}>
            {#each teesOf(db.courses, newRound.course) as t (t.id)}<option value={t.id}>{t.tee ?? 'Main'} tees</option>{/each}
          </select>
        </div>
      {/if}
      <div class="row">
        <button type="submit">Add round</button>
        <button type="button" class="secondary" onclick={() => (adding = false)}>Cancel</button>
      </div>
    </form>
    {/if}
  </section>

  {#if nudge}
    <div class="backdrop">
      <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="nudge-title">
        <h3 id="nudge-title">Teams saved — now set the pairings</h3>
        <p>Scores and the leaderboard won't show these players until pairings are set.</p>
        <a class="pairbtn" href="#/admin/pairings/{nudge.id}" onclick={() => (nudge = null)}>Set pairings for {nudge.name} →</a>
        <button class="secondary" onclick={() => (nudge = null)}>OK, later</button>
      </div>
    </div>
  {/if}

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
  .steps { display: flex; gap: 6px; margin-bottom: 10px; }
  .steps button { flex: 1; min-height: 40px; background: var(--surface); color: var(--muted); border: 1px solid var(--line); font-size: 0.85rem; margin-top: 0; }
  .steps button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .pickbar { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 6px; }
  .linkbtn { background: none; color: var(--accent); min-height: 0; padding: 0 0 0 12px; margin-top: 0; }
  .picklist { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-bottom: 10px; }
  .pick { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .pick:last-child { border-bottom: 0; }
  .pick.sel { background: #eef5f0; }
  .pick input { width: 22px; height: 22px; accent-color: var(--accent); }
  .pick .pname { flex: 1; font-weight: 600; }
  .totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .tot { border-radius: 12px; padding: 8px 12px; color: #fff; display: flex; flex-direction: column; }
  .tot strong { font-size: 1.4rem; }
  .tot span { font-size: 0.78rem; opacity: 0.9; }
  .warn { background: #fff4e5; border: 1px solid #f0c27a; border-radius: 10px; padding: 8px 12px; font-size: 0.85rem; }
  .teamrow { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .teamrow .pname { flex: 1; font-weight: 600; }
  .seg { display: flex; flex: none; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .seg button { margin-top: 0; min-height: 40px; border-radius: 0; background: var(--surface); color: var(--muted); padding: 6px 10px; font-size: 0.8rem; }
  .seg button + button { border-left: 1px solid var(--line); }
  .wide { width: 100%; }
  .rhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .rhead h2 { margin: 0; }
  .addbtn { margin-top: 0; min-height: 38px; padding: 8px 14px; background: var(--surface); color: var(--accent); border: 2px solid var(--accent); }
  .pairing { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .pairbtn {
    display: block; text-align: center; padding: 12px 16px; border-radius: 10px; font-weight: 700; text-decoration: none;
    background: var(--surface); color: var(--accent); border: 2px solid var(--accent);
  }
  .pstatus { font-size: 0.85rem; color: #a0521a; text-align: center; }
  .pstatus.ok { color: var(--shot-text); }
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.45); display: grid; place-items: center; padding: 16px; z-index: 50; }
  .dialog { max-width: 420px; width: 100%; display: flex; flex-direction: column; gap: 10px; }
  .dialog h3 { margin: 0; }
  .dialog p { margin: 0; }
  .dialog button { margin-top: 0; }
  .hcp { text-align: center; color: var(--muted); }
  .pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .round { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
  .player-tees summary { cursor: pointer; font-weight: 600; margin: 4px 0 8px; }
  .more summary { cursor: pointer; font-weight: 700; padding: 12px 0; color: var(--muted); }
  input[type='color'] { padding: 4px; }
</style>
