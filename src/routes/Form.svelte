<script lang="ts">
  import { db, photoUrl, playerName } from '../lib/data/store.svelte';
  import { buildEventView } from '../lib/view';
  import { computeForm, rankForm, type FormMetric, type FormRow } from '../lib/form';
  import { formatPoints } from '../lib/scoring';
  import Avatar from '../components/Avatar.svelte';

  const METRICS: { id: FormMetric; label: string; note: string }[] = [
    { id: 'gross', label: 'Gross', note: 'Total strokes to par (pick-ups left out).' },
    { id: 'net', label: 'Net', note: 'Strokes to par after full course-handicap shots (pick-ups left out).' },
    { id: 'points', label: 'Points', note: "Points from confirmed matches — each player gets their side's points." },
    { id: 'birdies', label: 'Birdies', note: 'Birdies or better (gross).' },
    { id: 'trebles', label: 'Trebles+', note: 'Treble bogey or worse, including pick-ups.' },
  ];

  let metric = $state<FormMetric>('net');
  let roundId = $state<string>('all');

  const view = $derived(buildEventView(db));
  const ranked = $derived(view ? rankForm(computeForm(view, roundId === 'all' ? null : roundId), metric) : []);
  const note = $derived(METRICS.find((m) => m.id === metric)!.note);

  const toPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
  function main(r: FormRow): string {
    switch (metric) {
      case 'gross': return r.holes ? toPar(r.grossToPar) : '–';
      case 'net': return r.holes ? toPar(r.netToPar) : '–';
      case 'points': return formatPoints(r.points);
      case 'birdies': return String(r.birdies);
      case 'trebles': return String(r.trebles);
    }
  }
  function detail(r: FormRow): string {
    if (metric === 'gross') return r.holes ? `Gross ${r.gross} · ${r.holes} holes` : 'yet to play';
    if (metric === 'net') return r.holes ? `Net ${r.net} · ${r.holes} holes` : 'yet to play';
    return r.holes ? `${r.holes} holes played` : '';
  }
  const colour = (r: FormRow) => (r.team === 'A' ? 'var(--team-a)' : 'var(--team-b)');
</script>

<h1>Form</h1>

{#if !view}
  <p class="center muted">No active event yet.</p>
{:else}
  <div class="metrics" role="tablist">
    {#each METRICS as m (m.id)}
      <button role="tab" aria-selected={metric === m.id} class:active={metric === m.id} onclick={() => (metric = m.id)}>{m.label}</button>
    {/each}
  </div>
  <div class="field">
    <label for="form-day">Days</label>
    <select id="form-day" bind:value={roundId}>
      <option value="all">All days</option>
      {#each view.rounds as rv (rv.round.id)}<option value={rv.round.id}>{rv.round.name}</option>{/each}
    </select>
  </div>
  <p class="muted small">{note}</p>

  <ol class="list" data-testid="form-list">
    {#each ranked as { row, rank } (row.playerId)}
      <li class="card item" data-testid="form-row">
        <span class="rank">{rank ?? '–'}</span>
        <Avatar name={playerName(row.playerId)} url={photoUrl(row.playerId)} colour={colour(row)} size={40} />
        <span class="who">
          <strong style="color:{colour(row)}">{playerName(row.playerId)}</strong>
          {#if detail(row)}<span class="muted small">{detail(row)}</span>{/if}
        </span>
        <span class="value" data-testid="form-value">{main(row)}</span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .metrics { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 10px; }
  .metrics button { flex: none; background: var(--surface); color: var(--text); border: 1px solid var(--line); padding: 10px 12px; font-size: 0.9rem; }
  .metrics button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .list { list-style: none; padding: 0; margin: 0; }
  .item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 8px; }
  .rank { width: 24px; text-align: center; font-weight: 800; color: var(--muted); }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .who strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .value { font-size: 1.3rem; font-weight: 800; font-variant-numeric: tabular-nums; }
</style>
