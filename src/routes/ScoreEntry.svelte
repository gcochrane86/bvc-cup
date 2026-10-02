<script lang="ts">
  import { readScoringGroup, rememberScoringGroup } from '../lib/scoringMemory';
  import { untrack } from 'svelte';
  import { db, enterScore, loadAll, photoUrl, playerName, playerShort } from '../lib/data/store.svelte';
  import { buildEventView, findGroup, firstIncompleteHole, matchesLabel, matchLabel, onlyGroupId, pairingLabel, resumeGroupId, scoringList } from '../lib/view';
  import { gameLabel, isScoreLocked, playerHole, scoreKey, shotLabel, strokesOnHole, type Slot } from '../lib/scoring';
  import Avatar from '../components/Avatar.svelte';
  import HoleGrid from '../components/HoleGrid.svelte';

  let { groupId, startHole = null }: { groupId: string | null; startHole?: number | null } = $props();

  const SLOTS: Slot[] = ['A1', 'A2', 'B1', 'B2', 'P1', 'P2', 'P3'];
  /** A row's colour: team A/B, or in an individual game P1 (the single / first player) against the rest. */
  const sideColour = (slot: Slot) => {
    // Season team events: each golfer in their own team's colour.
    const team = db.event?.season && found ? db.eventPlayers.find((p) => p.player_id === found!.group.slots[slot])?.team : null;
    if (team) return `var(--team-${team.toLowerCase()})`;
    return slot.startsWith('A') || slot === 'P1' ? 'var(--team-a)' : 'var(--team-b)';
  };

  const view = $derived(buildEventView(db));
  const found = $derived(view && groupId ? findGroup(view, groupId) : null);
  const toScore = $derived(view ? scoringList(view) : []);

  // This phone remembers the match it's scoring: Scores goes straight back to it until it's confirmed.
  const remembered = readScoringGroup;
  const remember = rememberScoringGroup;

  // Decide from fresh data: a match reopened moments ago must not look confirmed and be forgotten.
  let fresh = $state(false);
  $effect(() => {
    if (!groupId && !fresh) void loadAll().then(() => (fresh = true));
  });
  // Back to the match this phone was scoring — or straight into the only match there is to score. Decided from
  // the data already on the phone, so the list never flashes up first.
  const jumpTo = $derived(!groupId && view ? (resumeGroupId(remembered(), toScore) ?? onlyGroupId(toScore)) : null);
  $effect(() => {
    if (groupId) {
      // A hole link from another match's summary is a quick fix, not a switch of match.
      if (found && (startHole === null || !remembered())) remember(groupId);
      return;
    }
    if (jumpTo) {
      location.replace(`#/score/${jumpTo}`);
      return;
    }
    if (fresh) remember(null); // confirmed or gone (checked against fresh data): forget it and show the list
  });
  function allMatches(e: MouseEvent) {
    e.preventDefault();
    remember(null);
    location.hash = '#/score';
  }

  // Opened from a hole on the match summary: start there. (App keys this page by group and hole.)
  let pickedHole = $state<number | null>(untrack(() => startHole));
  const hole = $derived(found ? (pickedHole ?? firstIncompleteHole(found.group, found.round.holes)) : 1);
  const info = $derived(found?.round.holes.find((h) => h.hole === hole) ?? null);

  // edited: changed on this phone (always sent). hasScore: a saved score exists for this cell.
  // Several phones may score the same hole, so an untouched row is only ever a par default.
  type Draft = { gross: number; pickedUp: boolean; edited: boolean; hasScore: boolean };
  let draft = $state<Record<string, Draft>>({});

  // Rebuild the draft when the group or hole changes.
  const draftKey = $derived(`${found?.group.group.id ?? ''}:${hole}:${info ? 'ready' : 'none'}`);
  $effect(() => {
    void draftKey;
    untrack(() => {
      draft = buildDraft();
    });
  });

  // Live: rows not edited on this phone follow scores that others save for this hole.
  $effect(() => {
    if (!found || !info) return;
    const scores = found.group.scores;
    const h = hole;
    untrack(() => {
      for (const slot of SLOTS) {
        const pid = found.group.slots[slot];
        const d = pid ? draft[pid] : undefined;
        const e = pid ? scores.get(scoreKey(pid, h)) : undefined;
        if (!pid || !d || d.edited || !e) continue;
        d.gross = e.gross ?? ownPar(pid);
        d.pickedUp = e.pickedUp;
        d.hasScore = true;
      }
    });
  });

  /** This hole's par on the player's own tee. */
  function ownPar(pid: string): number {
    if (!found || !info) return 4;
    return playerHole({ teeHoles: found.group.teeHoles }, pid, info).par;
  }

  function buildDraft(): Record<string, Draft> {
    const out: Record<string, Draft> = {};
    if (!found || !info) return out;
    for (const slot of SLOTS) {
      const pid = found.group.slots[slot];
      if (!pid) continue;
      const e = found.group.scores.get(scoreKey(pid, hole));
      // Untouched rows start at par for the player's own tee (a par 5 on their tee is a par 5 here too).
      out[pid] = e
        ? { gross: e.gross ?? ownPar(pid), pickedUp: e.pickedUp, edited: false, hasScore: true }
        : { gross: ownPar(pid), pickedUp: false, edited: false, hasScore: false };
    }
    return out;
  }

  function shots(pid: string) {
    if (!found || !info) return { bb: 0, label: null as string | null, stableford: false };
    // The fourball, or an individual group's game: the shots each player gets on the hole.
    const bbMatch = found.group.matches.find((m) => m.def.type === 'better_ball' || m.def.type === 'individual');
    const singles = found.group.matches.find(
      (m) => m.def.type !== 'better_ball' && [...m.def.sideA, ...m.def.sideB].includes(pid),
    );
    const own = playerHole({ teeHoles: found.group.teeHoles }, pid, info); // the player's own tee
    const bb = bbMatch ? strokesOnHole(bbMatch.def.strokes[pid] ?? 0, own.strokeIndex) : 0;
    const sg = singles ? strokesOnHole(singles.def.strokes[pid] ?? 0, own.strokeIndex) : null;
    return { bb, label: shotLabel(bb, sg), stableford: !!bbMatch?.def.stableford };
  }

  /** Fourball Stableford points for the score being entered (a pick-up scores 0). */
  function points(pid: string, bb: number): number {
    const d = draft[pid];
    if (!info || !found || d.pickedUp) return 0;
    const par = playerHole({ teeHoles: found.group.teeHoles }, pid, info).par; // own tee's par
    return Math.max(0, 2 + par - (d.gross - bb));
  }

  const locked = (pid: string, h: number) => (found ? isScoreLocked(pid, h, found.group.matches) : false);

  function holeState(h: number): string {
    if (!found) return '';
    const ids = SLOTS.map((s) => found.group.slots[s]).filter((x): x is string => !!x);
    if (ids.length && ids.every((id) => locked(id, h))) return 'locked';
    const entered = ids.filter((id) => found.group.scores.has(scoreKey(id, h))).length;
    return entered === ids.length && ids.length > 0 ? 'done' : entered > 0 ? 'partial' : '';
  }

  function bump(pid: string, delta: number) {
    const d = draft[pid];
    d.gross = Math.min(15, Math.max(1, d.gross + delta));
    d.pickedUp = false;
    d.edited = true;
  }

  const allLocked = $derived(
    !!found && SLOTS.every((s) => {
      const pid = found.group.slots[s];
      return !pid || locked(pid, hole);
    }),
  );

  // 2-man scramble: one row per team (the A1 and B1 rows), saved for both partners.
  const scramble = $derived(found?.group.matches[0]?.def.scramble ? found.group.matches[0].def : null);
  const rowSlots = $derived<Slot[]>(scramble ? ['A1', 'B1'] : SLOTS);
  /** A scramble team's players, in name order. */
  function teamIds(slot: Slot): string[] {
    if (!found) return [];
    return (slot.startsWith('A') ? ['A1', 'A2'] : ['B1', 'B2'])
      .map((s) => found!.group.slots[s as Slot])
      .filter((x): x is string => !!x)
      .sort((a, b) => playerShort(a).localeCompare(playerShort(b), 'en', { sensitivity: 'base' }));
  }
  const teamLabel = (slot: Slot) => teamIds(slot).map(playerShort).join(' & ');

  async function save() {
    if (!found) return;
    const group = found.group;
    // Pin the hole being saved: `hole` is derived and, when no hole was tapped, moves on to the next
    // incomplete hole as soon as these scores land — so reading it afterwards would skip a hole.
    const saving = hole;
    const at = new Date().toISOString();
    // The rows as they are now: saving a score updates rows live, and a scramble partner must be saved
    // from the team row as it was, not as it becomes once the first partner's score lands.
    const rows = Object.fromEntries(Object.entries(draft).map(([id, d]) => [id, { ...d }]));
    for (const slot of SLOTS) {
      const pid = group.slots[slot];
      // Scramble: the team's row (A1/B1) is the score for both partners.
      const from = scramble && (slot === 'A2' || slot === 'B2') ? group.slots[slot === 'A2' ? 'A1' : 'B1'] : pid;
      if (!pid || !from || locked(pid, saving) || !rows[from]) continue;
      const d = rows[from];
      // Untouched rows that already have a score (possibly entered on another phone) are left alone.
      if (!d.edited && d.hasScore) continue;
      await enterScore({
        roundId: found.round.round.id,
        playerId: pid,
        hole: saving,
        gross: d.pickedUp ? null : d.gross,
        pickedUp: d.pickedUp,
        clientUpdatedAt: at,
        // An untouched row is only a par default: it must never overwrite someone's real score.
        ifAbsent: !d.edited,
      });
    }
    pickedHole = Math.min(18, saving + 1);
  }

</script>

{#if !view}
  <p class="center">No active event yet.</p>
{:else if !found && jumpTo}
  <p class="center muted">Loading…</p>
{:else if !found}
  <h1>Which match are you scoring?</h1>
  {#each toScore as day (day.round.round.id)}
    <h2 class="day">{day.round.round.name}</h2>
    {#each day.groups as g (g.group.id)}
      <a class="card group-pick" href="#/score/{g.group.id}" data-testid="score-pick">
        <strong>{matchesLabel(g)}</strong>
        <span class="muted small">{pairingLabel(g, playerShort)}</span>
      </a>
    {/each}
  {:else}
    <p class="muted">No matches left to score. Confirmed matches drop off this list; the admin can reopen one if needed.</p>
  {/each}
{:else if !info}
  <p class="center">This round's course has no holes set up yet.</p>
{:else}
  <header class="head">
    <div>
      <h1>Hole {hole}</h1>
      <p class="muted">Par {info.par} · SI {info.strokeIndex} · {found.round.round.name} · {matchesLabel(found.group)}</p>
    </div>
    {#if db.pending.length}
      <span class="pending" data-testid="pending">{db.pending.length} waiting to send</span>
    {/if}
  </header>

  <!-- Like the match summary: who won each hole and the running score (the fourball's), tap to pick a hole. -->
  {@const summary = found.group.matches.find((m) => m.def.type === 'better_ball' || m.def.type === 'individual') ?? found.group.matches[0]}
  {#if summary}
    <HoleGrid state={summary.state} onPick={(h) => (pickedHole = h)} selected={hole} holeClass={holeState} />
  {/if}

  <div class="statuses">
    {#each found.group.matches as m (m.def.id)}
      {@const lead = m.result ? (m.result.winner === 'A' ? 1 : m.result.winner === 'B' ? -1 : 0) : m.state.lead}
      <span>
        <small class="muted">{m.def.scramble ? 'Scramble' : m.def.game ? gameLabel(m.def.game) : matchLabel(m.def.type)}</small>
        <strong style="color:{lead > 0 ? 'var(--team-a)' : lead < 0 ? 'var(--team-b)' : 'var(--muted)'}">
          {m.result?.resultText ?? m.state.statusText}
        </strong>
      </span>
    {/each}
  </div>

  {#each rowSlots as slot (slot)}
    {@const pid = found.group.slots[slot]}
    {#if pid && draft[pid]}
      {@const sh = shots(pid)}
      {@const isLocked = locked(pid, hole)}
      {@const team = scramble ? teamLabel(slot) : null}
      <div class="prow card" class:shot={sh.bb === 1} class:shot2={sh.bb >= 2} data-testid="row-{slot}">
        {#if team}
          <span class="faces">
            {#each teamIds(slot) as id (id)}<Avatar name={playerName(id)} url={photoUrl(id)} colour={sideColour(slot)} size={36} />{/each}
          </span>
        {:else}
          <Avatar name={playerName(pid)} url={photoUrl(pid)} colour={sideColour(slot)} size={44} />
        {/if}
        <div class="who">
          {#if team}
            <strong>{team}</strong> <span class="muted small">({scramble?.teamHandicap?.[pid]})</span>
          {:else}
            <strong>{playerName(pid)}</strong> <span class="muted small">({found.group.playingHcp[pid]})</span>
          {/if}
          <div class="chips">
            {#if sh.label}<span class="chip shotchip">{sh.label}</span>{/if}
            {#if sh.stableford}<span class="chip pts">{points(pid, sh.bb)} pts</span>{/if}
            {#if !team && found.group.teeOf[pid]}<span class="chip tee">{found.group.teeOf[pid].tee ?? 'Other'} tees</span>{/if}
            {#if isLocked}<span class="chip lock">Locked</span>{/if}
          </div>
        </div>
        <div class="stepper">
          <button class="secondary" aria-label="Decrease {playerName(pid)}" disabled={isLocked || draft[pid].pickedUp} onclick={() => bump(pid, -1)}>−</button>
          <span class="val" class:untouched={!draft[pid].edited && !draft[pid].hasScore} data-testid="gross-{slot}">{draft[pid].pickedUp ? 'P' : draft[pid].gross}</span>
          <button class="secondary" aria-label="Increase {playerName(pid)}" disabled={isLocked || draft[pid].pickedUp} onclick={() => bump(pid, 1)}>+</button>
        </div>
        <label class="pu">
          <input type="checkbox" bind:checked={draft[pid].pickedUp} disabled={isLocked} onchange={() => (draft[pid].edited = true)} />
          Picked up
        </label>
      </div>
    {/if}
  {/each}

  <button class="save" onclick={save} disabled={allLocked}>Save hole {hole}</button>
  {#if !onlyGroupId(toScore)}<p class="muted small"><a href="#/score" onclick={allMatches}>← All matches</a></p>{/if}
{/if}

<style>
  .group-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .day { font-size: 1rem; margin: 16px 0 8px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .head h1 { margin-bottom: 2px; }
  .head p { margin: 0 0 10px; }
  .pending { background: #fff4e5; color: #6b3d00; font-weight: 700; font-size: 0.8rem; padding: 6px 10px; border-radius: 999px; white-space: nowrap; }
  .statuses { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .statuses span { display: flex; flex-direction: column; }
  .prow { display: grid; grid-template-columns: auto 1fr auto; grid-template-areas: 'av who step' 'av pu step'; gap: 4px 10px; align-items: center; border: 2px solid transparent; }
  .prow :global(.avatar) { grid-area: av; }
  .prow.shot { background: var(--shot); border-color: var(--shot-strong); }
  .prow.shot2 { background: var(--shot-strong); border-color: var(--shot-text); }
  .who { grid-area: who; min-width: 0; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
  .chip { font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 999px; }
  .shotchip { background: var(--shot-text); color: #fff; }
  .pts { background: var(--accent); color: #fff; }
  .faces { display: flex; flex: none; }
  .faces :global(.avatar + .avatar) { margin-left: -12px; }
  .tee { background: var(--line); color: var(--text); }
  .lock { background: #ddd; color: #333; }
  .stepper { grid-area: step; display: flex; align-items: center; gap: 6px; }
  .stepper button { width: 48px; height: 48px; padding: 0; font-size: 1.5rem; }
  .val { width: 36px; text-align: center; font-size: 1.6rem; font-weight: 800; }
  .val.untouched { color: var(--muted); }
  .pu { grid-area: pu; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--muted); margin: 0; }
  .save { width: 100%; font-size: 1.1rem; margin-top: 4px; }
</style>
