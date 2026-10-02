<script lang="ts">
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import { individualPairingErrors, orderSlots, pairingErrors, type Slot } from '../../lib/scoring';
  import type { EventPlayerRow, GroupPlayerRow, GroupRow, RoundRow } from '../../lib/data/types';

  let { roundId }: { roundId: string } = $props();

  /** crossed: singles are A1 v B2 & A2 v B1. locked: a singles result is confirmed, so the line-up can't change. */
  type Draft = { groupNo: number; teeTime: string; a: string[]; b: string[]; crossed: boolean; locked: boolean };
  let round = $state<RoundRow | null>(null);
  let members = $state<EventPlayerRow[]>([]);
  let drafts = $state<Draft[]>([]);
  let errors = $state<string[]>([]);
  let msg = $state<string | null>(null);
  /** Individual events: groups of 2 or 3 (empty places ''), and which place plays alone in a 2 v 1. */
  /** locked: the group's game is confirmed, so its players can't change and it can't be removed. */
  type IndDraft = { groupNo: number; teeTime: string; players: string[]; single: number; locked: boolean };
  let individual = $state(false);
  let groupsDraft = $state<IndDraft[]>([]);
  /** Saved groups taken off the list: deleted (by number) on save. Groups keep their numbers, so a removal
   *  never moves another group's players or confirmed result. */
  let removedNos = $state<number[]>([]);

  async function load() {
    const id = roundId;
    const r = (await must(supabase.from('rounds').select('*').eq('id', id).single())) as RoundRow;
    const [eps, gs] = await Promise.all([
      must(supabase.from('event_players').select('*').eq('event_id', r.event_id)) as Promise<EventPlayerRow[]>,
      must(supabase.from('groups').select('*, group_players(*), match_results(match_type)').eq('round_id', id).order('group_no')) as Promise<
        (GroupRow & { group_players: GroupPlayerRow[]; match_results: { match_type: string }[] })[]
      >,
    ]);
    const ev = (await must(supabase.from('events').select('kind').eq('id', r.event_id).single())) as { kind: string };
    round = r;
    members = eps;
    individual = ev.kind === 'individual';
    if (individual) {
      // Each group's players by position; in a 2 v 1 the single is P1.
      groupsDraft = gs.map((g) => {
        const at = (slot: Slot) => g.group_players.find((p) => p.slot === slot)?.player_id ?? '';
        return {
          groupNo: g.group_no, teeTime: g.tee_time?.slice(0, 5) ?? '', players: [at('P1'), at('P2'), at('P3')], single: 0,
          locked: g.match_results.length > 0,
        };
      });
      removedNos = [];
      return;
    }
    const count = Math.max(1, Math.floor(eps.length / 4));
    drafts = Array.from({ length: count }, (_, i) => {
      const g = gs.find((x) => x.group_no === i + 1);
      const at = (slot: Slot) => g?.group_players.find((p) => p.slot === slot)?.player_id ?? '';
      return {
        groupNo: i + 1,
        teeTime: g?.tee_time?.slice(0, 5) ?? '',
        a: [at('A1'), at('A2')],
        b: [at('B1'), at('B2')],
        crossed: g?.singles_crossed ?? false,
        locked: (g?.match_results ?? []).some((m) => m.match_type !== 'better_ball'),
      };
    });
  }
  $effect(() => {
    void load();
  });

  const nameOf = (id: string) => db.players.find((p) => p.id === id)?.name ?? '?';
  const hcpOf = (id: string) => Number(members.find((m) => m.player_id === id)?.handicap ?? 0);
  const teamPlayers = (team: 'A' | 'B') => members.filter((m) => m.team === team);

  /** Lower handicap goes to slot 1, so low plays low and high plays high in day-3 singles. */
  function autoOrder(pair: string[]) {
    if (!pair[0] || !pair[1]) return;
    const sorted = orderSlots('A', pair.map((id) => ({ playerId: id, handicap: hcpOf(id) })));
    pair[0] = sorted[0].playerId;
    pair[1] = sorted[1].playerId;
  }
  // Explicit handler rather than bind: — the pair arrays are reached through an inline {#each} literal.
  function pick(pair: string[], i: number, e: Event) {
    pair[i] = (e.currentTarget as HTMLSelectElement).value;
    autoOrder(pair);
  }
  function swap(pair: string[]) {
    [pair[0], pair[1]] = [pair[1], pair[0]];
  }

  const shortOf = (id: string) => db.players.find((p) => p.id === id)?.short_name ?? '?';
  /** The two singles for a draft: [[A player, B player], [A player, B player]]. */
  const singlesOf = (d: Draft, crossed = d.crossed) => [
    [d.a[0], crossed ? d.b[1] : d.b[0]],
    [d.a[1], crossed ? d.b[0] : d.b[1]],
  ];
  const lineup = (d: Draft, crossed = d.crossed) =>
    singlesOf(d, crossed).map(([a, b], i) => `Singles ${i + 1}: ${a ? shortOf(a) : '?'} v ${b ? shortOf(b) : '?'}`).join(' · ');
  function drawSingles() {
    for (const d of drafts) if (!d.locked) d.crossed = Math.random() < 0.5;
    msg = 'Singles drawn — press Save pairings to publish them.';
  }

  const twoVOne = $derived(!!round?.three_game.startsWith('two_v_one'));
  const addGroup = () =>
    groupsDraft.push({ groupNo: Math.max(0, ...groupsDraft.map((g) => g.groupNo), ...removedNos) + 1, teeTime: '', players: ['', '', ''], single: 0, locked: false });
  function removeGroup(i: number) {
    removedNos.push(groupsDraft[i].groupNo);
    groupsDraft.splice(i, 1);
  }
  async function saveGroups() {
    msg = null;
    errors = individualPairingErrors(groupsDraft.map((g) => g.players.map((p) => p || null)));
    if (errors.length) return;
    try {
      for (const g of groupsDraft) {
        if (g.locked) continue; // a confirmed group stays exactly as it is
        const ids = g.players.filter(Boolean);
        // 2 v 1: the single goes to P1; the others follow in order.
        const single = g.players[g.single];
        const ordered = twoVOne && ids.length === 3 && single ? [single, ...ids.filter((id) => id !== single)] : ids;
        await must(
          supabase.rpc('save_group', {
            p_round_id: roundId,
            p_group_no: g.groupNo,
            p_tee_time: g.teeTime || null,
            p_slots: ordered.map((player_id, i) => ({ slot: `P${i + 1}`, player_id })),
          }),
        );
      }
      // Groups taken off the list go, with their players.
      if (removedNos.length) await must(supabase.from('groups').delete().eq('round_id', roundId).in('group_no', removedNos));
      removedNos = [];
      await loadAll();
      msg = 'Groups saved';
    } catch (e) {
      errors = [(e as Error).message];
    }
  }

  async function saveAll() {
    msg = null;
    errors = pairingErrors(drafts.map((d) => ({ a: d.a.map((x) => x || null), b: d.b.map((x) => x || null) })));
    if (errors.length) return;
    try {
      for (const d of drafts) {
        await must(
          supabase.rpc('save_group', {
            p_round_id: roundId,
            p_group_no: d.groupNo,
            p_tee_time: d.teeTime || null,
            p_slots: [
              { slot: 'A1', player_id: d.a[0] },
              { slot: 'A2', player_id: d.a[1] },
              { slot: 'B1', player_id: d.b[0] },
              { slot: 'B2', player_id: d.b[1] },
            ],
          }),
        );
        if (round?.singles_enabled && !d.locked) {
          const crossed = round.singles_pairing === 'handicap' ? false : d.crossed;
          await must(supabase.from('groups').update({ singles_crossed: crossed }).eq('round_id', roundId).eq('group_no', d.groupNo));
        }
      }
      await loadAll();
      msg = 'Pairings saved';
    } catch (e) {
      errors = [(e as Error).message];
    }
  }
</script>

{#if round && individual}
  <p><a href="#/admin/events/{round.event_id}">← Event</a></p>
  <h1>{round.name} groups</h1>
  <p class="muted small">Groups of 2 or 3.{#if twoVOne} In a 3-ball, choose who plays alone (2 v 1).{/if}</p>
  {#each groupsDraft as g, gi (g.groupNo)}
    <section class="card" data-testid="ind-group">
      <div class="row">
        <h3>Group {g.groupNo}</h3>
        <input aria-label="Group {g.groupNo} tee time" type="time" bind:value={g.teeTime} />
        {#if !g.locked}
          <button class="secondary remove" aria-label="Remove group {g.groupNo}" onclick={() => removeGroup(gi)}>✕</button>
        {/if}
      </div>
      {#if g.locked}<p class="muted small">Confirmed, so this group is fixed. Reopen it on the event page to change it.</p>{/if}
      {#each [0, 1, 2] as i (i)}
        <div class="indrow">
          <select aria-label="Group {g.groupNo} player {i + 1}" bind:value={g.players[i]} disabled={g.locked}>
            <option value="">{i === 2 ? '— (2-ball)' : '—'}</option>
            {#each members as m (m.player_id)}<option value={m.player_id}>{nameOf(m.player_id)} ({m.handicap})</option>{/each}
          </select>
          {#if twoVOne && !g.locked && g.players.filter(Boolean).length === 3 && g.players[i]}
            <label class="alone">
              <input type="radio" name="single-{g.groupNo}" aria-label="Group {g.groupNo}: {nameOf(g.players[i])} plays alone" checked={g.single === i} onchange={() => (g.single = i)} />
              alone
            </label>
          {/if}
        </div>
      {/each}
    </section>
  {/each}
  <button class="secondary wide add" onclick={addGroup}>+ Add group</button>
  {#each errors as err (err)}<p class="error">{err}</p>{/each}
  {#if msg}<p>{msg}</p>{/if}
  <button class="wide" onclick={saveGroups}>Save groups</button>
{:else if round}
  <p><a href="#/admin/events/{round.event_id}">← Event</a></p>
  <h1>{round.name} pairings</h1>
  <p class="muted small">Pick 2 players per team for each group. The lower handicap is put first automatically; ⇅ swaps them.</p>
  {#if round.singles_enabled}
    <div class="card singles-mode">
      <strong>Singles pairings:</strong>
      {round.singles_pairing === 'handicap' ? 'by handicap (low v low, high v high)' : round.singles_pairing === 'random' ? 'random draw' : 'chosen by admin'}
      <span class="muted small">— change this on the event page.</span>
      {#if round.singles_pairing === 'random'}
        <button class="secondary draw" onclick={drawSingles}>🎲 Draw singles at random</button>
      {/if}
    </div>
  {/if}
  {#each drafts as d (d.groupNo)}
    <section class="card">
      <div class="row">
        <h3>Group {d.groupNo}</h3>
        <input aria-label="Group {d.groupNo} tee time" type="time" bind:value={d.teeTime} />
      </div>
      {#each [{ team: 'A' as const, pair: d.a }, { team: 'B' as const, pair: d.b }] as side (side.team)}
        <div class="pair">
          {#each [0, 1] as i (i)}
            <select
              aria-label="Group {d.groupNo} team {side.team} player {i + 1}"
              value={side.pair[i]}
              onchange={(e) => pick(side.pair, i, e)}
              style="border-color:var(--team-{side.team === 'A' ? 'a' : 'b'})"
            >
              <option value="">—</option>
              {#each teamPlayers(side.team) as m (m.player_id)}
                <option value={m.player_id}>{nameOf(m.player_id)} ({m.handicap})</option>
              {/each}
            </select>
          {/each}
          <button class="secondary" aria-label="Swap team {side.team} order" onclick={() => swap(side.pair)}>⇅</button>
        </div>
      {/each}
      {#if round.singles_enabled && d.a[0] && d.a[1] && d.b[0] && d.b[1]}
        <div class="singles" data-testid="singles-{d.groupNo}">
          {#if round.singles_pairing === 'selected' && !d.locked}
            <p class="muted small pick">Choose the singles line-up:</p>
            {#each [false, true] as crossed (crossed)}
              <label class="choice" class:chosen={d.crossed === crossed}>
                <input type="radio" name="singles-{d.groupNo}" checked={d.crossed === crossed} onchange={() => (d.crossed = crossed)} />
                <span class="lines">
                  {#each singlesOf(d, crossed) as [a, b], i (i)}
                    <span><strong>Singles {i + 1}:</strong> {a ? shortOf(a) : '?'} v {b ? shortOf(b) : '?'}</span>
                  {/each}
                </span>
              </label>
            {/each}
          {:else}
            <p class="small">{lineup(d, round.singles_pairing === 'handicap' && !d.locked ? false : d.crossed)}</p>
          {/if}
          {#if d.locked}<p class="muted small">A singles result is confirmed, so this line-up is fixed.</p>{/if}
        </div>
      {/if}
    </section>
  {/each}
  {#each errors as err (err)}<p class="error">{err}</p>{/each}
  {#if msg}<p>{msg}</p>{/if}
  <button class="wide" onclick={saveAll}>Save pairings</button>
{:else}
  <p class="center muted">Loading…</p>
{/if}

<style>
  .pair { display: grid; grid-template-columns: 1fr 1fr 48px; gap: 6px; margin-top: 8px; }
  .pair select { border-width: 2px; }
  .row h3 { margin: 0; flex: 1; }
  .row input { width: 120px; }
  .wide { width: 100%; }
  .indrow { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .indrow select { flex: 1; }
  .alone { display: flex; gap: 4px; align-items: center; white-space: nowrap; margin: 0; }
  .remove { padding: 8px 12px; }
  .add { margin-bottom: 8px; }
  .singles { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }
  .singles p { margin: 0; }
  .pick { margin-bottom: 6px; }
  .choice {
    display: flex; gap: 12px; align-items: center; font-size: 0.95rem; margin: 6px 0; padding: 10px 12px;
    border: 1px solid var(--line); border-radius: 10px; cursor: pointer; min-height: 44px;
  }
  .choice.chosen { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, white); }
  .choice input { width: 20px; height: 20px; margin: 0; accent-color: var(--accent); }
  .lines { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .singles-mode .draw { display: block; width: 100%; margin-top: 8px; }
</style>
