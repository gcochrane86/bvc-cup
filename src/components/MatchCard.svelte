<script lang="ts">
  import Avatar from './Avatar.svelte';
  import { db, photoUrl, playerName, playerShort } from '../lib/data/store.svelte';
  import { matchLabel, type MatchView } from '../lib/view';
  import { formatToPar, gameLabel, type PairNet } from '../lib/scoring';

  let { mv, teeTime = null, link = true }: { mv: MatchView; teeTime?: string | null; link?: boolean } = $props();

  const s = $derived(mv.state);
  /** A side's colour: Team A/B — in a season 1 v 1 or 2 v 1, the team its golfers are actually on. */
  function sideColour(ids: string[], fallback: 'a' | 'b'): string {
    const team = db.event?.season && mv.def.game ? db.eventPlayers.find((p) => p.player_id === ids[0])?.team : null;
    return `var(--team-${team ? team.toLowerCase() : fallback})`;
  }
  const colourA = $derived(sideColour(mv.def.sideA, 'a'));
  const colourB = $derived(sideColour(mv.def.sideB, 'b'));
  const lead = $derived(mv.result ? (mv.result.winner === 'A' ? 1 : mv.result.winner === 'B' ? -1 : 0) : s.lead);
  const colour = $derived(lead > 0 ? colourA : lead < 0 ? colourB : 'var(--muted)');
  const status = $derived(mv.result ? mv.result.resultText : s.statusText);
  const sub = $derived(
    mv.result ? '' : s.decided ? 'Awaiting confirmation' : s.started ? `THRU ${s.thru}${s.dormie ? ' · DORMIE' : ''}` : teeTime ? `Tee ${teeTime.slice(0, 5)}` : '',
  );
  const netText = (n: PairNet) => `${formatToPar(n.toPar)} net · thru ${n.thru}`;
  const badge = $derived(mv.result ? 'FINAL' : s.decided ? 'CONFIRM' : s.started && s.lead !== 0 ? 'LEADS' : null);
</script>

<svelte:element
  this={link ? 'a' : 'div'}
  class="card match"
  href={link ? `#/match/${mv.def.groupId}/${mv.def.type}` : undefined}
  data-testid="match-card"
  data-match-id={mv.def.id}
>
  <!-- The badge sits on the leading team's side (left when level). -->
  <header>
    <span class="slot">{#if badge && lead >= 0}<span class="badge" style="background:{colour}">{badge}</span>{/if}</span>
    <span class="title">
      <strong>Match {mv.number}</strong>
      {#if mv.def.game}<small class="muted">{gameLabel(mv.def.game)}</small>
      {:else if mv.def.type !== 'better_ball'}<small class="muted">{matchLabel(mv.def.type)}</small>{/if}
    </span>
    <span class="slot right">{#if badge && lead < 0}<span class="badge" style="background:{colour}">{badge}</span>{/if}</span>
  </header>
  {#if mv.def.game === 'six_stableford' || mv.def.game === 'six_flat'}
    <!-- Six pointer: three players, each with their points so far. -->
    <div class="six">
      {#each mv.def.players ?? [] as id (id)}
        <div class="who">
          <Avatar name={playerName(id)} url={photoUrl(id)} colour="var(--team-a)" size={40} />
          <span class="name">{playerShort(id)}</span>
          <strong class="pts">{mv.result?.playerPoints?.[id]?.points ?? mv.state.totals?.[id] ?? 0}</strong>
        </div>
      {/each}
    </div>
    <div class="status six-status"><strong data-testid="status">{status}</strong>{#if sub}<small class="muted">{sub}</small>{/if}</div>
  {:else}
  <div class="body">
    <div class="side">
      <div class="faces">
        {#each mv.def.sideA as id (id)}<Avatar name={playerName(id)} url={photoUrl(id)} colour={colourA} size={44} />{/each}
      </div>
      {#each mv.def.sideA as id (id)}<div class="name">{playerShort(id)}</div>{/each}
      {#if mv.net?.a}<div class="net" data-testid="net-a">{netText(mv.net.a)}</div>{/if}
    </div>
    <div class="status" style="color:{colour}">
      <strong data-testid="status">{status}</strong>
      {#if sub}<small class="muted">{sub}</small>{/if}
    </div>
    <div class="side right">
      <div class="faces">
        {#each mv.def.sideB as id (id)}<Avatar name={playerName(id)} url={photoUrl(id)} colour={colourB} size={44} />{/each}
      </div>
      {#each mv.def.sideB as id (id)}<div class="name">{playerShort(id)}</div>{/each}
      {#if mv.net?.b}<div class="net" data-testid="net-b">{netText(mv.net.b)}</div>{/if}
    </div>
  </div>
  {/if}
</svelte:element>

<style>
  header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; margin-bottom: 10px; min-height: 24px; }
  .slot.right { text-align: right; }
  .title { display: flex; flex-direction: column; align-items: center; line-height: 1.15; }
  .title strong { font-size: 0.95rem; }
  .title small { font-size: 0.7rem; }
  .badge { color: #fff; font-weight: 800; font-size: 0.75rem; padding: 4px 10px; border-radius: 999px; letter-spacing: 0.04em; }
  .body { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .side { min-width: 0; }
  .right { text-align: right; }
  .faces { display: flex; margin-bottom: 6px; }
  .right .faces { justify-content: flex-end; }
  .faces :global(.avatar + .avatar) { margin-left: -12px; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .net { font-size: 0.75rem; font-weight: 600; color: var(--muted); margin-top: 2px; white-space: nowrap; }
  .status { text-align: center; display: flex; flex-direction: column; min-width: 92px; }
  .status strong { font-size: 1.4rem; font-weight: 800; }
  .status small { font-size: 0.75rem; font-weight: 600; }
  .six { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; }
  .six .who { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .six .name { max-width: 100%; }
  .six .pts { font-size: 1.2rem; }
  .six-status { margin-top: 6px; }
</style>
