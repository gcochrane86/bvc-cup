<script lang="ts">
  import Avatar from './Avatar.svelte';
  import { photoUrl, playerShort } from '../lib/data/store.svelte';
  import { matchLabel, type MatchView } from '../lib/view';

  let { mv, groupNo, teeTime = null, link = true }: { mv: MatchView; groupNo: number; teeTime?: string | null; link?: boolean } = $props();

  const s = $derived(mv.state);
  const lead = $derived(mv.result ? (mv.result.winner === 'A' ? 1 : mv.result.winner === 'B' ? -1 : 0) : s.lead);
  const colour = $derived(lead > 0 ? 'var(--team-a)' : lead < 0 ? 'var(--team-b)' : 'var(--muted)');
  const status = $derived(mv.result ? mv.result.resultText : s.statusText);
  const sub = $derived(
    mv.result ? '' : s.decided ? 'Awaiting confirmation' : s.started ? `THRU ${s.thru}${s.dormie ? ' · DORMIE' : ''}` : teeTime ? `Tee ${teeTime.slice(0, 5)}` : '',
  );
  const badge = $derived(mv.result ? 'FINAL' : s.decided ? 'CONFIRM' : s.started && s.lead !== 0 ? 'LEADS' : null);
</script>

<svelte:element
  this={link ? 'a' : 'div'}
  class="card match"
  href={link ? `#/match/${mv.def.groupId}/${mv.def.type}` : undefined}
  data-testid="match-card"
  data-match-id={mv.def.id}
>
  <header>
    <span class="muted small">{matchLabel(mv.def.type)} · Group {groupNo}</span>
    {#if badge}<span class="badge" style="background:{colour}">{badge}</span>{/if}
  </header>
  <div class="body">
    <div class="side">
      <div class="faces">
        {#each mv.def.sideA as id (id)}<Avatar name={playerShort(id)} url={photoUrl(id)} colour="var(--team-a)" size={44} />{/each}
      </div>
      {#each mv.def.sideA as id (id)}<div class="name">{playerShort(id)}</div>{/each}
    </div>
    <div class="status" style="color:{colour}">
      <strong data-testid="status">{status}</strong>
      {#if sub}<small class="muted">{sub}</small>{/if}
    </div>
    <div class="side right">
      <div class="faces">
        {#each mv.def.sideB as id (id)}<Avatar name={playerShort(id)} url={photoUrl(id)} colour="var(--team-b)" size={44} />{/each}
      </div>
      {#each mv.def.sideB as id (id)}<div class="name">{playerShort(id)}</div>{/each}
    </div>
  </div>
</svelte:element>

<style>
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; min-height: 24px; }
  .badge { color: #fff; font-weight: 800; font-size: 0.75rem; padding: 4px 10px; border-radius: 999px; letter-spacing: 0.04em; }
  .body { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .side { min-width: 0; }
  .right { text-align: right; }
  .faces { display: flex; margin-bottom: 6px; }
  .right .faces { justify-content: flex-end; }
  .faces :global(.avatar + .avatar) { margin-left: -12px; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { text-align: center; display: flex; flex-direction: column; min-width: 92px; }
  .status strong { font-size: 1.4rem; font-weight: 800; }
  .status small { font-size: 0.75rem; font-weight: 600; }
</style>
