<script lang="ts">
  import { isBirdieOrBetter, playerHole, scoreKey, strokesOnHole, type HoleInfo, type MatchDef, type ScoreIndex, type Team } from '../lib/scoring';
  import { playerShort } from '../lib/data/store.svelte';

  let { def, holes, scores, teamOf, playingHcp = {} }: {
    def: MatchDef; holes: HoleInfo[]; scores: ScoreIndex; teamOf: Record<string, Team>; playingHcp?: Record<string, number>;
  } = $props();

  // Out and In by hole number (a day playing only some holes may have few or none on one side).
  const nines = $derived([holes.filter((h) => h.hole <= 9), holes.filter((h) => h.hole > 9)].filter((n) => n.length));
  const players = $derived([...def.sideA, ...def.sideB]);

  function birdie(pid: string, h: HoleInfo): boolean {
    const e = scores.get(scoreKey(pid, h.hole));
    return !!e && !e.pickedUp && isBirdieOrBetter(e.gross, playerHole(def, pid, h).par); // own tee's par
  }
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
        <tr><th>{nine[0].hole <= 9 ? 'Out' : 'In'}</th>{#each nine as h (h.hole)}<th>{h.hole}</th>{/each}<th>Tot</th></tr>
      </thead>
      <tbody>
        <tr class="muted"><td>Par</td>{#each nine as h (h.hole)}<td>{h.par}</td>{/each}<td>{nine.reduce((s, h) => s + h.par, 0)}</td></tr>
        <tr class="muted"><td>SI</td>{#each nine as h (h.hole)}<td>{h.cardSi ?? h.strokeIndex}</td>{/each}<td></td></tr>
        {#each players as pid (pid)}
          <tr>
            <td class="pname" style="color:var(--team-{teamOf[pid] === 'A' ? 'a' : 'b'})">{playerShort(pid)}{#if playingHcp[pid] !== undefined} <small>({playingHcp[pid]})</small>{/if}</td>
            {#each nine as h (h.hole)}
              {@const own = playerHole(def, pid, h)}
              {@const shots = strokesOnHole(def.strokes[pid] ?? 0, own.strokeIndex, own.of)}
              <td class:shot={shots > 0}><span class:birdie={birdie(pid, h)}>{cell(pid, h)}</span>{#if shots}<sup>{'•'.repeat(shots)}</sup>{/if}</td>
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
  .birdie { color: #d0021b; font-weight: 800; }
  sup { color: var(--shot-text); font-size: 0.7em; }
</style>
