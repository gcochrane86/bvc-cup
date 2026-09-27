<script lang="ts">
  import { scoreKey, strokesOnHole, type HoleInfo, type MatchDef, type ScoreIndex, type Team } from '../lib/scoring';
  import { playerShort } from '../lib/data/store.svelte';

  let { def, holes, scores, teamOf, playingHcp = {} }: {
    def: MatchDef; holes: HoleInfo[]; scores: ScoreIndex; teamOf: Record<string, Team>; playingHcp?: Record<string, number>;
  } = $props();

  const nines = $derived([holes.slice(0, 9), holes.slice(9, 18)]);
  const players = $derived([...def.sideA, ...def.sideB]);

  function cell(pid: string, h: HoleInfo): string {
    const e = scores.get(scoreKey(pid, h.hole));
    if (!e) return '';
    return e.pickedUp ? 'P' : String(e.gross);
  }
  function total(pid: string, nine: HoleInfo[]): string {
    let sum = 0;
    let any = false;
    for (const h of nine) {
      const e = scores.get(scoreKey(pid, h.hole));
      if (e && !e.pickedUp && e.gross !== null) {
        sum += e.gross;
        any = true;
      }
    }
    return any ? String(sum) : '';
  }
</script>

{#each nines as nine, i (i)}
  <div class="card wrap">
    <table>
      <thead>
        <tr><th>{i === 0 ? 'Out' : 'In'}</th>{#each nine as h (h.hole)}<th>{h.hole}</th>{/each}<th>Tot</th></tr>
      </thead>
      <tbody>
        <tr class="muted"><td>Par</td>{#each nine as h (h.hole)}<td>{h.par}</td>{/each}<td>{nine.reduce((s, h) => s + h.par, 0)}</td></tr>
        <tr class="muted"><td>SI</td>{#each nine as h (h.hole)}<td>{h.strokeIndex}</td>{/each}<td></td></tr>
        {#each players as pid (pid)}
          <tr>
            <td class="pname" style="color:var(--team-{teamOf[pid] === 'A' ? 'a' : 'b'})">{playerShort(pid)}{#if playingHcp[pid] !== undefined} <small>({playingHcp[pid]})</small>{/if}</td>
            {#each nine as h (h.hole)}
              {@const shots = strokesOnHole(def.strokes[pid] ?? 0, h.strokeIndex)}
              <td class:shot={shots > 0}>{cell(pid, h)}{#if shots}<sup>{'•'.repeat(shots)}</sup>{/if}</td>
            {/each}
            <td><strong>{total(pid, nine)}</strong></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/each}

<style>
  .wrap { overflow-x: auto; padding: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: center; }
  th, td { padding: 6px 2px; border-bottom: 1px solid var(--line); }
  th:first-child, td:first-child { text-align: left; }
  .pname small { font-weight: 500; color: var(--muted); }
  .pname { font-weight: 700; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.shot { background: var(--shot); }
  sup { color: var(--shot-text); font-size: 0.7em; }
</style>
