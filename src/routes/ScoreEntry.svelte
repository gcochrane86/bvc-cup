<script lang="ts">
  import { untrack } from 'svelte';
  import { db, enterScore, photoUrl, playerName } from '../lib/data/store.svelte';
  import { buildEventView, defaultRoundId, findGroup, firstIncompleteHole, matchLabel, today } from '../lib/view';
  import { isScoreLocked, scoreKey, shotLabel, strokesOnHole, type Slot } from '../lib/scoring';
  import Avatar from '../components/Avatar.svelte';

  let { groupId }: { groupId: string | null } = $props();

  const REMEMBER = 'golf.scoringGroup';
  const SLOTS: Slot[] = ['A1', 'A2', 'B1', 'B2'];

  function readRemembered(): string | null {
    try {
      return localStorage.getItem(REMEMBER);
    } catch {
      return null;
    }
  }
  let remembered = $state(readRemembered());

  function choose(id: string) {
    try {
      localStorage.setItem(REMEMBER, id);
    } catch {
      /* private mode — fine, the URL still carries the group */
    }
    remembered = id;
    location.hash = `#/score/${id}`;
  }
  function changeGroup() {
    try {
      localStorage.removeItem(REMEMBER);
    } catch {
      /* ignore */
    }
    remembered = null;
    location.hash = '#/score';
  }

  const view = $derived(buildEventView(db));
  const gid = $derived(groupId ?? remembered);
  const found = $derived(view && gid ? findGroup(view, gid) : null);
  const pickerRoundId = $derived(view ? defaultRoundId(view.rounds.map((r) => r.round), today()) : null);

  let pickedHole = $state<number | null>(null);
  const hole = $derived(found ? (pickedHole ?? firstIncompleteHole(found.group, found.round.holes)) : 1);
  const info = $derived(found?.round.holes.find((h) => h.hole === hole) ?? null);

  type Draft = { gross: number; pickedUp: boolean; touched: boolean };
  let draft = $state<Record<string, Draft>>({});

  // Rebuild the draft only when the group or hole changes — not on every live update.
  const draftKey = $derived(`${found?.group.group.id ?? ''}:${hole}:${info ? 'ready' : 'none'}`);
  $effect(() => {
    void draftKey;
    untrack(() => {
      draft = buildDraft();
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
        ? { gross: e.gross ?? info.par, pickedUp: e.pickedUp, touched: true }
        : { gross: info.par, pickedUp: false, touched: false };
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
    d.touched = true;
  }

  const allLocked = $derived(
    !!found && SLOTS.every((s) => {
      const pid = found.group.slots[s];
      return !pid || locked(pid, hole);
    }),
  );

  async function save() {
    if (!found) return;
    const at = new Date().toISOString();
    for (const slot of SLOTS) {
      const pid = found.group.slots[slot];
      if (!pid || locked(pid, hole) || !draft[pid]) continue;
      const d = draft[pid];
      await enterScore({
        roundId: found.round.round.id,
        playerId: pid,
        hole,
        gross: d.pickedUp ? null : d.gross,
        pickedUp: d.pickedUp,
        clientUpdatedAt: at,
      });
    }
    pickedHole = Math.min(18, hole + 1);
  }
</script>

{#if !view}
  <p class="center">No active event yet.</p>
{:else if !found}
  <h1>Which group are you scoring?</h1>
  {#each view.rounds.filter((r) => r.round.id === pickerRoundId) as rv (rv.round.id)}
    <p class="muted">{rv.round.name}</p>
    {#each rv.groups as g (g.group.id)}
      <button class="group-pick secondary" onclick={() => choose(g.group.id)}>
        <strong>Group {g.group.group_no}</strong>
        <span class="muted small">
          {SLOTS.map((s) => g.slots[s]).filter((x): x is string => !!x).map(playerName).join(', ')}
        </span>
      </button>
    {:else}
      <p class="muted">No pairings yet for this round.</p>
    {/each}
  {/each}
{:else if !info}
  <p class="center">This round's course has no holes set up yet.</p>
{:else}
  <header class="head">
    <div>
      <h1>Hole {hole}</h1>
      <p class="muted">Par {info.par} · SI {info.strokeIndex} · {found.round.round.name} · Group {found.group.group.group_no}</p>
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
          <strong>{playerName(pid)}</strong>
          <div class="chips">
            {#if sh.label}<span class="chip shotchip">{sh.label}</span>{/if}
            {#if isLocked}<span class="chip lock">Locked</span>{/if}
          </div>
        </div>
        <div class="stepper">
          <button class="secondary" aria-label="Decrease {playerName(pid)}" disabled={isLocked || draft[pid].pickedUp} onclick={() => bump(pid, -1)}>−</button>
          <span class="val" class:untouched={!draft[pid].touched} data-testid="gross-{slot}">{draft[pid].pickedUp ? 'P' : draft[pid].gross}</span>
          <button class="secondary" aria-label="Increase {playerName(pid)}" disabled={isLocked || draft[pid].pickedUp} onclick={() => bump(pid, 1)}>+</button>
        </div>
        <label class="pu">
          <input type="checkbox" bind:checked={draft[pid].pickedUp} disabled={isLocked} onchange={() => (draft[pid].touched = true)} />
          Picked up
        </label>
      </div>
    {/if}
  {/each}

  <button class="save" onclick={save} disabled={allLocked}>Save hole {hole}</button>
  <p class="muted small">Scoring for a different group? <button class="linklike" onclick={changeGroup}>Change group</button></p>
{/if}

<style>
  .group-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; margin-bottom: 10px; text-align: left; }
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
  .linklike { background: none; color: var(--accent); padding: 0; min-height: 0; text-decoration: underline; font-weight: 500; }
</style>
