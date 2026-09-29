<script lang="ts">
  // The day buttons on the Leaderboard and Scorecard tabs. With a long season the row scrolls sideways: it opens
  // scrolled to the selected day (usually the latest), and a fade on the left shows there are earlier days.
  let { days, selected, onPick }: { days: { id: string; name: string }[]; selected: string | null; onPick: (id: string) => void } =
    $props();

  let row = $state<HTMLElement>();
  let earlier = $state(false);
  const update = () => (earlier = !!row && row.scrollLeft > 4);

  // Bring the selected day fully into view (scrolling the row only, never the page).
  $effect(() => {
    void selected;
    void days.length;
    if (!row) return;
    const btn = row.querySelector<HTMLElement>('[aria-selected="true"]');
    if (btn) {
      const left = btn.offsetLeft - row.offsetLeft;
      const right = left + btn.offsetWidth;
      if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
      else if (left < row.scrollLeft) row.scrollLeft = left;
    }
    update();
  });
</script>

<div class="wrap" class:earlier>
  <div class="tabs" role="tablist" bind:this={row} onscroll={update}>
    {#each days as d (d.id)}
      <button role="tab" aria-selected={d.id === selected} class:active={d.id === selected} onclick={() => onPick(d.id)}>
        {d.name}
      </button>
    {/each}
  </div>
</div>

<style>
  .wrap { position: relative; margin: 4px 0 8px; }
  .tabs { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; position: relative; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { background: var(--surface); color: var(--text); border: 1px solid var(--line); flex: none; }
  .tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  /* Earlier days off to the left. */
  .wrap.earlier::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 28px; z-index: 1; pointer-events: none;
    background: linear-gradient(to right, var(--bg), transparent);
  }
</style>
