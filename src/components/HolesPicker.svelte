<script lang="ts">
  // Holes played: All 18, Front 9, Holes 1 to N (− / +, e.g. 1–12), or chosen holes (e.g. winter: 1–9, 14 and 18).
  // Used by Add round and each day's settings. holes: null = all 18; [] = none chosen yet (not allowed).
  import { holesFor, holesPreset, type HolesMode } from '../lib/holes';

  let { id, holes = $bindable(null) }: { id: string; holes?: number[] | null } = $props();

  const ALL = Array.from({ length: 18 }, (_, i) => i + 1);
  const start = holesPreset(holes);
  let mode = $state<HolesMode>(start.mode);
  let to = $state(start.to);
  let chosen = $state<number[]>(start.mode === 'custom' && holes?.length ? [...holes] : [...ALL]);

  /** The holes for the current choice: a chosen set of all 18 is just All 18. */
  function update() {
    holes = mode === 'custom' ? (chosen.length >= 18 ? null : chosen) : holesFor(mode, to);
  }
  const pick = (m: HolesMode) => ((mode = m), update());
  const step = (d: number) => ((to = Math.min(17, Math.max(1, to + d))), update());
  const toggle = (h: number, on: boolean) => ((chosen = on ? [...new Set([...chosen, h])].sort((a, b) => a - b) : chosen.filter((x) => x !== h)), update());
</script>

<div class="chips">
  {#each [['all', 'All 18'], ['front', 'Front 9'], ['to', 'Holes 1 to…'], ['custom', 'Choose holes']] as [m, label] (m)}
    <label class="chip" class:on={mode === m}><input type="radio" name="{id}-holes" aria-label={label} checked={mode === m} onchange={() => pick(m as HolesMode)} />{label}</label>
  {/each}
</div>
{#if mode === 'to'}
  <div class="stepper">
    <span>Holes 1 to</span>
    <button type="button" class="secondary" aria-label="Fewer holes" disabled={to <= 1} onclick={() => step(-1)}>−</button>
    <strong data-testid="holes-to">{to}</strong>
    <button type="button" class="secondary" aria-label="More holes" disabled={to >= 17} onclick={() => step(1)}>+</button>
  </div>
{:else if mode === 'custom'}
  <div class="holegrid">
    {#each ALL as h (h)}
      <label class="hole" class:on={chosen.includes(h)}>
        <input type="checkbox" aria-label="Play hole {h}" checked={chosen.includes(h)} onchange={(e) => toggle(h, (e.currentTarget as HTMLInputElement).checked)} />{h}
      </label>
    {/each}
  </div>
{/if}
{#if holes?.length}<p class="muted small"><span data-testid="holes-count">{holes.length} holes</span> · handicaps scale to {holes.length}/18</p>{/if}
{#if holes && !holes.length}<p class="error small">Pick at least one hole.</p>{/if}

<style>
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { position: relative; display: inline-flex; align-items: center; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 0.85rem; cursor: pointer; margin: 0; }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  /* The radio covers its whole chip (invisible), so a tap anywhere on it picks it. */
  .chip input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .chip:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .stepper { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .stepper button { width: 40px; min-height: 40px; padding: 0; font-size: 1.2rem; margin: 0; }
  .stepper strong { font-size: 1.3rem; min-width: 28px; text-align: center; }
  .holegrid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin: 6px 0; }
  .hole { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 0.8rem; padding: 4px 0; border: 1px solid var(--line); border-radius: 8px; margin: 0; }
  .hole.on { border-color: var(--accent); background: #e3efe7; }
  .hole input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
</style>
