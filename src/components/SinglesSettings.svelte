<script lang="ts">
  import type { Snippet } from 'svelte';
  // Singles in each fourball: one switch, and when on, points, allowance and who plays who right here.
  // Used by a day's settings and the Add round form.
  type Pairing = 'handicap' | 'random' | 'selected';
  let {
    id,
    enabled = $bindable(false),
    points = $bindable(0.5),
    allowance = $bindable(90),
    pairing = $bindable<Pairing>('handicap'),
    fixedPoints = null,
    choose,
  }: {
    /** Unique per form, for the inputs' ids. */
    id: string;
    enabled?: boolean;
    points?: number;
    allowance?: number;
    pairing?: Pairing;
    /** Season events: singles are worth the event's points, so they're shown, not edited. */
    fixedPoints?: number | null;
    /** Shown under "I'll choose": each fourball's line-ups (a day's settings). Without it, a hint says where to choose. */
    choose?: Snippet;
  } = $props();

  const CHOICES: { value: Pairing; label: string; hint: string }[] = [
    { value: 'handicap', label: 'By handicap', hint: 'Low v low, high v high. Set automatically.' },
    { value: 'random', label: 'Random draw', hint: 'Drawn for each fourball when the pairings are saved.' },
    { value: 'selected', label: "I'll choose", hint: "Pick each fourball's singles in the day's settings once it's paired." },
  ];
  const worth = $derived(fixedPoints ?? Number(points));
</script>

<div class="singles" class:on={enabled}>
  <label class="shead">
    <span><strong>Singles</strong><span class="sub">{enabled ? `2 in each fourball · worth ${worth} each` : 'Off · fourballs only'}</span></span>
    <input class="switch" type="checkbox" role="switch" aria-label="Play singles" bind:checked={enabled} />
  </label>
  {#if enabled}
    <div class="nums">
      {#if fixedPoints === null}
        <span class="num"><label for="{id}-sp">Points</label><input id="{id}-sp" type="number" step="0.5" min="0" bind:value={points} /></span>
      {/if}
      <span class="num"><label for="{id}-sa">Allowance %</label><input id="{id}-sa" type="number" min="0" max="100" bind:value={allowance} /></span>
    </div>
    <span class="lbl">Who plays who</span>
    <div class="chips">
      {#each CHOICES as c (c.value)}
        <label class="chip" class:on={pairing === c.value}><input type="radio" name="{id}-pairing" value={c.value} bind:group={pairing} />{c.label}</label>
      {/each}
    </div>
    {#if pairing === 'selected' && choose}
      {@render choose()}
    {:else}
      <p class="hint">{CHOICES.find((c) => c.value === pairing)?.hint}</p>
    {/if}
  {/if}
</div>

<style>
  .singles { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin: 8px 0; display: grid; gap: 10px; }
  .singles.on { border-color: var(--accent); background: #eef5f0; }
  .shead { display: flex; justify-content: space-between; align-items: center; gap: 10px; cursor: pointer; }
  .shead strong { display: block; }
  .sub { display: block; font-size: 0.8rem; color: var(--muted); }
  .nums { display: flex; gap: 8px; flex-wrap: wrap; }
  .num { display: flex; align-items: center; gap: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; font-size: 0.85rem; }
  .num input { width: 4.5em; min-height: 0; padding: 4px 6px; margin: 0; }
  .lbl { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { position: relative; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 6px 12px; font-size: 0.85rem; cursor: pointer; }
  .chip.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  /* The radio covers its whole chip (invisible), so a tap anywhere on it picks it. */
  .chip input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .hint { margin: -4px 0 0; font-size: 0.8rem; color: var(--muted); }
</style>
