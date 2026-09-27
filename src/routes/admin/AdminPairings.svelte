<script lang="ts">
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import { orderSlots, pairingErrors, type Slot } from '../../lib/scoring';
  import type { EventPlayerRow, GroupPlayerRow, GroupRow, RoundRow } from '../../lib/data/types';

  let { roundId }: { roundId: string } = $props();

  type Draft = { groupNo: number; teeTime: string; a: string[]; b: string[] };
  let round = $state<RoundRow | null>(null);
  let members = $state<EventPlayerRow[]>([]);
  let drafts = $state<Draft[]>([]);
  let errors = $state<string[]>([]);
  let msg = $state<string | null>(null);

  async function load() {
    const id = roundId;
    const r = (await must(supabase.from('rounds').select('*').eq('id', id).single())) as RoundRow;
    const [eps, gs] = await Promise.all([
      must(supabase.from('event_players').select('*').eq('event_id', r.event_id)) as Promise<EventPlayerRow[]>,
      must(supabase.from('groups').select('*, group_players(*)').eq('round_id', id).order('group_no')) as Promise<
        (GroupRow & { group_players: GroupPlayerRow[] })[]
      >,
    ]);
    round = r;
    members = eps;
    const count = Math.max(1, Math.floor(eps.length / 4));
    drafts = Array.from({ length: count }, (_, i) => {
      const g = gs.find((x) => x.group_no === i + 1);
      const at = (slot: Slot) => g?.group_players.find((p) => p.slot === slot)?.player_id ?? '';
      return { groupNo: i + 1, teeTime: g?.tee_time?.slice(0, 5) ?? '', a: [at('A1'), at('A2')], b: [at('B1'), at('B2')] };
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
      }
      await loadAll();
      msg = 'Pairings saved';
    } catch (e) {
      errors = [(e as Error).message];
    }
  }
</script>

{#if round}
  <p><a href="#/admin/events/{round.event_id}">← Event</a></p>
  <h1>{round.name} pairings</h1>
  <p class="muted small">Pick 2 players per team for each group. The lower handicap is put first automatically; ⇅ swaps them (on singles days, player 1 plays the other team's player 1).</p>
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
</style>
