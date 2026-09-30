<script lang="ts">
  import { untrack } from 'svelte';
  import { db, photoUrl, playerName, playerShort } from '../lib/data/store.svelte';
  import { buildEventView } from '../lib/view';
  import { computeForm, computePairForm, rankForm, type FormMetric, type FormRow, type PairFormRow } from '../lib/form';
  import { formatPoints } from '../lib/scoring';
  import Avatar from '../components/Avatar.svelte';

  const METRICS: { id: FormMetric; label: string; note: string }[] = [
    { id: 'gross', label: 'Gross', note: 'Total strokes to par (pick-ups left out).' },
    { id: 'net', label: 'Net', note: 'Strokes to par after full course-handicap shots (pick-ups left out).' },
    { id: 'stableford', label: 'Stableford', note: 'Stableford points off full course handicap: 2 for net par, 1 more per shot better, 0 for a pick-up.' },
    { id: 'points', label: 'Points', note: "Points from confirmed matches — each player gets their side's points." },
    { id: 'birdies', label: 'Birdies', note: 'Birdies or better (gross).' },
    { id: 'trebles', label: 'Trebles+', note: 'Treble bogey or worse, including pick-ups.' },
  ];

  let metric = $state<FormMetric>('net');
  let roundId = $state<string>('all');

  const view = $derived(buildEventView(db));
  // Scramble days are team scores: when every chosen day is a scramble there are no individual rankings, so
  // the tab opens on Pairs.
  const scrambleOnly = $derived.by(() => {
    const days = (view?.rounds ?? []).filter((r) => roundId === 'all' || r.round.id === roundId);
    return days.length > 0 && days.every((r) => r.settings.fourballFormat === 'scramble');
  });
  let who = $state<'individuals' | 'pairs'>(untrack(() => (scrambleOnly ? 'pairs' : 'individuals')));
  const ranked = $derived(view ? rankForm(computeForm(view, roundId === 'all' ? null : roundId), metric) : []);
  const rankedPairs = $derived(view ? rankForm(computePairForm(view, roundId === 'all' ? null : roundId), metric) : []);
  // The pair's players in name order (the name and the photos follow the same order).
  const pairIds = (r: PairFormRow) =>
    [...r.playerIds].sort((a, b) => playerShort(a).localeCompare(playerShort(b), 'en', { sensitivity: 'base' }));
  const pairName = (r: PairFormRow) => pairIds(r).map(playerShort).join(' & ');
  function pairMain(r: PairFormRow): string {
    switch (metric) {
      case 'gross': return r.holes ? toPar(r.grossToPar) : '–';
      case 'net': return r.holes ? toPar(r.netToPar) : '–';
      case 'stableford': return String(r.stableford);
      case 'points': return formatPoints(r.points);
      case 'birdies': return String(r.birdies);
      case 'trebles': return String(r.trebles);
    }
  }
  const note = $derived(METRICS.find((m) => m.id === metric)!.note);

  const toPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
  function main(r: FormRow): string {
    switch (metric) {
      case 'gross': return r.holes ? toPar(r.grossToPar) : '–';
      case 'net': return r.holes ? toPar(r.netToPar) : '–';
      case 'stableford': return String(r.stableford);
      case 'points': return formatPoints(r.points);
      case 'birdies': return String(r.birdies);
      case 'trebles': return String(r.trebles);
    }
  }
  function detail(r: FormRow): string {
    if (metric === 'gross') return r.holes ? `Gross ${r.gross} · ${r.holes} holes` : 'yet to play';
    if (metric === 'net') return r.holes ? `Net ${r.net} · ${r.holes} holes` : 'yet to play';
    if (metric === 'stableford') return r.holes + r.pickups ? `${r.holes + r.pickups} holes` : 'yet to play';
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
  <div class="who-toggle" role="group" aria-label="Rank players or pairs">
    <button class:active={who === 'individuals'} aria-pressed={who === 'individuals'} onclick={() => (who = 'individuals')}>Individuals</button>
    <button class:active={who === 'pairs'} aria-pressed={who === 'pairs'} onclick={() => (who = 'pairs')}>Pairs</button>
  </div>
  <p class="muted small">{note}{#if who === 'pairs'}&nbsp;Pairs count their better ball on each hole both have played; the same pair on several days adds up.{/if}</p>

  {#if who === 'pairs'}
    <ol class="list" data-testid="form-list">
      {#each rankedPairs as { row, rank } (row.key)}
        {@const c = row.team === 'A' ? 'var(--team-a)' : 'var(--team-b)'}
        <li class="card item" data-testid="form-row">
          <span class="rank">{rank ?? '–'}</span>
          <span class="faces">
            {#each pairIds(row) as id (id)}<Avatar name={playerName(id)} url={photoUrl(id)} colour={c} size={34} />{/each}
          </span>
          <span class="who">
            <strong style="color:{c}">{pairName(row)}</strong>
            <span class="muted small">{row.holes ? `${row.holes} holes` : 'yet to play'}</span>
          </span>
          <span class="value" data-testid="form-value">{pairMain(row)}</span>
        </li>
      {:else}
        <p class="muted">No fourball pairs yet.</p>
      {/each}
    </ol>
  {:else if scrambleOnly}
    <p class="muted">Scramble days are team scores, so there are no individual rankings. See Pairs.</p>
  {:else}
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
{/if}

<style>
  .metrics { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 10px; }
  .metrics button { flex: none; background: var(--surface); color: var(--text); border: 1px solid var(--line); padding: 10px 12px; font-size: 0.9rem; }
  .metrics button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .list { list-style: none; padding: 0; margin: 0; }
  .who-toggle { display: flex; gap: 0; margin: 4px 0 8px; }
  .who-toggle button { flex: 1; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0; padding: 8px; font-size: 0.9rem; }
  .who-toggle button:first-child { border-radius: 8px 0 0 8px; }
  .who-toggle button:last-child { border-radius: 0 8px 8px 0; }
  .who-toggle button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .faces { display: flex; flex: none; }
  .faces :global(.avatar + .avatar) { margin-left: -10px; }
  .item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 8px; }
  .rank { width: 24px; text-align: center; font-weight: 800; color: var(--muted); }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .who strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .value { font-size: 1.3rem; font-weight: 800; font-variant-numeric: tabular-nums; }
</style>
