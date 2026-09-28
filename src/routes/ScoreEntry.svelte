<script lang="ts">
  import { untrack } from 'svelte';
  import { db, enterScore, loadAll, photoUrl, playerName, playerShort } from '../lib/data/store.svelte';
  import { buildEventView, findGroup, firstIncompleteHole, matchesLabel, matchLabel, pairingLabel, resumeGroupId, scoringList } from '../lib/view';
  import { isScoreLocked, scoreKey, shotLabel, strokesOnHole, type Slot } from '../lib/scoring';
  import Avatar from '../components/Avatar.svelte';

  let { groupId }: { groupId: string | null } = $props();

  const SLOTS: Slot[] = ['A1', 'A2', 'B1', 'B2'];

  const view = $derived(buildEventView(db));
  const found = $derived(view && groupId ? findGroup(view, groupId) : null);
  const toScore = $derived(view ? scoringList(view) : []);

  // This phone remembers the match it's scoring: Scores goes straight back to it until it's confirmed.
  const REMEMBER = 'golf.scoringGroup';
  function remembered(): string | null {
    try {
      return localStorage.getItem(REMEMBER);
    } catch {
      return null; // private mode: the list is shown each time instead
    }
  }
  function remember(id: string | null) {
    try {
      if (id) localStorage.setItem(REMEMBER, id);
      else localStorage.removeItem(REMEMBER);
    } catch {
      /* ignore */
    }
  }
  // Decide from fresh data: a match reopened moments ago must not look confirmed and be forgotten.
  let fresh = $state(false);
  $effect(() => {
    if (!groupId && !fresh) void loadAll().then(() => (fresh = true));
  });
  $effect(() => {
    if (groupId) {
      if (found) remember(groupId);
      return;
    }
    if (!fresh) return;
    const resume = resumeGroupId(remembered(), toScore);
    if (resume) location.replace(`#/score/${resume}`);
    else remember(null); // confirmed or gone: forget it and show the list
  });
  function allMatches(e: MouseEvent) {
    e.preventDefault();
    remember(null);
    location.hash = '#/score';
  }

  let pickedHole = $state<number | null>(null);
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
        if (!d || d.edited || !e) continue;
        d.gross = e.gross ?? info.par;
        d.pickedUp = e.pickedUp;
        d.hasScore = true;
      }
    });
  });

  function buildDraft(): Record<string, Draft> {
    const out: Record<string, Draft> = {};
    if (!found || !info) return out;
    for (const slot of SLOTS) {
      const pid = found.group.slots[slot];
      if (!pid) continue;
      const e = found.group.scores.get(scoreKey(pid, hole));
      out[pid] = e
        ? { gross: e.gross ?? info.par, pickedUp: e.pickedUp, edited: false, hasScore: true }
        : { gross: info.par, pickedUp: false, edited: false, hasScore: false };
    }
    return out;
  }

  function shots(pid: string) {
    if (!found || !info) return { bb: 0, label: null as string | null };
    const bbMatch = found.group.matches.find((m) => m.def.type === 'better_ball');
    const singles = found.group.matches.find(
      (m) => m.def.type !== 'better_ball' && [...m.def.sideA, ...m.def.sideB].includes(pid),
    );
    const bb = bbMatch ? strokesOnHole(bbMatch.def.strokes[pid] ?? 0, info.strokeIndex) : 0;
    const sg = singles ? strokesOnHole(singles.def.strokes[pid] ?? 0, info.strokeIndex) : null;
    return { bb, label: shotLabel(bb, sg) };
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

  async function save() {
    if (!found) return;
    // Pin the hole being saved: `hole` is derived and, when no hole was tapped, moves on to the next
    // incomplete hole as soon as these scores land — so reading it afterwards would skip a hole.
    const saving = hole;
    const at = new Date().toISOString();
    for (const slot of SLOTS) {
      const pid = found.group.slots[slot];
      if (!pid || locked(pid, saving) || !draft[pid]) continue;
      const d = draft[pid];
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

  <div class="strip">
    {#each found.round.holes as h (h.hole)}
      <button class="hole {holeState(h.hole)}" class:current={h.hole === hole} aria-label="Hole {h.hole}" onclick={() => (pickedHole = h.hole)}>
        {h.hole}
      </button>
    {/each}
  </div>

  <div class="statuses">
    {#each found.group.matches as m (m.def.id)}
      {@const lead = m.result ? (m.result.winner === 'A' ? 1 : m.result.winner === 'B' ? -1 : 0) : m.state.lead}
      <span>
        <small class="muted">{matchLabel(m.def.type)}</small>
        <strong style="color:{lead > 0 ? 'var(--team-a)' : lead < 0 ? 'var(--team-b)' : 'var(--muted)'}">
          {m.result?.resultText ?? m.state.statusText}
        </strong>
      </span>
    {/each}
  </div>

  {#each SLOTS as slot (slot)}
    {@const pid = found.group.slots[slot]}
    {#if pid && draft[pid]}
      {@const sh = shots(pid)}
      {@const isLocked = locked(pid, hole)}
      <div class="prow card" class:shot={sh.bb === 1} class:shot2={sh.bb >= 2} data-testid="row-{slot}">
        <Avatar name={playerName(pid)} url={photoUrl(pid)} colour={slot.startsWith('A') ? 'var(--team-a)' : 'var(--team-b)'} size={44} />
        <div class="who">
          <strong>{playerName(pid)}</strong> <span class="muted small">({found.group.playingHcp[pid]})</span>
          <div class="chips">
            {#if sh.label}<span class="chip shotchip">{sh.label}</span>{/if}
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
  <p class="muted small"><a href="#/score" onclick={allMatches}>← All matches</a></p>
{/if}

<style>
  .group-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .day { font-size: 1rem; margin: 16px 0 8px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .head h1 { margin-bottom: 2px; }
  .head p { margin: 0 0 10px; }
  .pending { background: #fff4e5; color: #6b3d00; font-weight: 700; font-size: 0.8rem; padding: 6px 10px; border-radius: 999px; white-space: nowrap; }
  .strip { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin-bottom: 12px; }
  .hole { min-height: 36px; padding: 0; border-radius: 8px; background: var(--surface); color: var(--text); border: 1px solid var(--line); font-size: 0.85rem; }
  .hole.done { background: #e7efe9; }
  .hole.partial { background: #fff4e5; }
  .hole.locked { background: #eee; color: var(--muted); }
  .hole.current { background: var(--accent); color: #fff; border-color: var(--accent); }
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
  .lock { background: #ddd; color: #333; }
  .stepper { grid-area: step; display: flex; align-items: center; gap: 6px; }
  .stepper button { width: 48px; height: 48px; padding: 0; font-size: 1.5rem; }
  .val { width: 36px; text-align: center; font-size: 1.6rem; font-weight: 800; }
  .val.untouched { color: var(--muted); }
  .pu { grid-area: pu; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--muted); margin: 0; }
  .save { width: 100%; font-size: 1.1rem; margin-top: 4px; }
</style>
