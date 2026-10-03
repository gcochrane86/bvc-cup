<script lang="ts">
  // A whole course guide scanned as one PDF: show each page, match pages to holes, then upload them together.
  import { untrack } from 'svelte';
  import { openPdf, pageHoles } from '../lib/pdfGuide';

  let {
    file,
    holesWithPhotos,
    onUpload,
    onCancel,
  }: {
    file: Blob;
    /** Holes that already have photos (to offer Add or Replace). */
    holesWithPhotos: number[];
    /** Upload: each page's hole (0 = skip, page 1 first), whether to replace existing photos, and how to render a page. */
    onUpload: (holes: number[], replace: boolean, render: (page: number) => Promise<Blob>, progress: (done: number) => void) => Promise<void>;
    onCancel: () => void;
  } = $props();

  let pdf = $state<Awaited<ReturnType<typeof openPdf>> | null>(null);
  let thumbs = $state<Record<number, string>>({});
  let holeOne = $state(1);
  let overrides = $state<Record<number, number>>({});
  let replace = $state(false);
  let error = $state<string | null>(null);
  let uploading = $state<{ done: number; total: number } | null>(null);
  const holes = $derived(pdf ? pageHoles(pdf.pages, holeOne, overrides) : []);
  const count = $derived(holes.filter((h) => h > 0).length);
  const clash = $derived(holesWithPhotos.some((h) => holes.includes(h)));

  // Open the PDF, then draw a small picture of each page.
  $effect(() => {
    const f = file;
    untrack(async () => {
      try {
        const p = await openPdf(f);
        pdf = p;
        for (let i = 1; i <= p.pages; i++) {
          const blob = await p.render(i, 160);
          thumbs = { ...thumbs, [i]: URL.createObjectURL(blob) };
        }
      } catch (e) {
        console.error('PDF open failed', e);
        error = "Couldn't open this PDF. Try saving the scan again (Share → Save to Files).";
      }
    });
    return () => Object.values(thumbs).forEach((u) => URL.revokeObjectURL(u));
  });

  function shift(by: number) {
    holeOne = Math.min(pdf?.pages ?? 1, Math.max(1, holeOne + by));
    overrides = {};
  }
  async function upload() {
    if (!pdf || !count) return;
    const p = pdf;
    uploading = { done: 0, total: count };
    try {
      await onUpload(holes, replace, (page) => p.render(page, 1600), (done) => (uploading = { done, total: count }));
    } catch (e) {
      error = `Error: ${(e as Error).message}`;
      uploading = null;
    }
  }
</script>

<div class="shade">
  <div class="sheet" role="dialog" aria-label="Match pages to holes">
    {#if error}
      <p class="error">{error}</p>
      <button class="secondary" onclick={onCancel}>Close</button>
    {:else if !pdf}
      <p class="muted">Opening the PDF…</p>
    {:else if uploading}
      <h2>Uploading {Math.min(uploading.done + 1, uploading.total)} of {uploading.total}</h2>
      <div class="bar"><span style="width:{(uploading.done / uploading.total) * 100}%"></span></div>
      <p class="muted small">Keep this screen open.</p>
    {:else}
      <h2>{pdf.pages} page{pdf.pages === 1 ? '' : 's'} found</h2>
      <div class="stepper">
        <span>Hole 1 is on page</span>
        <button class="secondary" aria-label="Hole 1 on an earlier page" disabled={holeOne <= 1} onclick={() => shift(-1)}>−</button>
        <strong>{holeOne}</strong>
        <button class="secondary" aria-label="Hole 1 on a later page" disabled={holeOne >= pdf.pages} onclick={() => shift(1)}>+</button>
      </div>
      <div class="list">
        {#each holes as hole, i (i)}
          {@const page = i + 1}
          <div class="row" class:skipped={!hole}>
            {#if thumbs[page]}<img src={thumbs[page]} alt="Page {page}" />{:else}<span class="ph"></span>{/if}
            <span class="t"><strong>Page {page}</strong><span class="muted small">{hole ? `Hole ${hole}` : 'Skipped'}</span></span>
            <select aria-label="Page {page} goes on" value={hole} onchange={(e) => (overrides = { ...overrides, [page]: Number((e.currentTarget as HTMLSelectElement).value) })}>
              <option value={0}>Skip</option>
              {#each Array.from({ length: 18 }, (_, h) => h + 1) as h (h)}<option value={h}>Hole {h}</option>{/each}
            </select>
          </div>
        {/each}
      </div>
      {#if clash}
        <span class="small">Holes that already have photos:</span>
        <div class="choice" role="group" aria-label="Holes that already have photos">
          <button class:on={!replace} aria-pressed={!replace} onclick={() => (replace = false)}>Add to them</button>
          <button class:on={replace} aria-pressed={replace} onclick={() => (replace = true)}>Replace them</button>
        </div>
      {/if}
      <button class="go" disabled={!count} onclick={upload}>Upload {count} page{count === 1 ? '' : 's'}</button>
      <button class="secondary" onclick={onCancel}>Cancel</button>
    {/if}
  </div>
</div>

<style>
  .shade { position: fixed; inset: 0; z-index: 60; background: rgb(0 0 0 / 0.5); display: flex; align-items: center; justify-content: center; padding: 12px; }
  .sheet { background: var(--surface); width: 100%; max-width: 560px; max-height: 100%; overflow: auto; border-radius: 18px; padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 10px; }
  h2 { margin: 0; font-size: 1.15rem; }
  .stepper { display: flex; align-items: center; gap: 10px; }
  .stepper button { width: 40px; min-height: 40px; padding: 0; margin: 0; font-size: 1.2rem; }
  .stepper strong { min-width: 24px; text-align: center; font-size: 1.2rem; }
  .list { display: grid; gap: 6px; max-height: 46vh; overflow-y: auto; }
  .row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 12px; padding: 6px; }
  .row.skipped { opacity: 0.6; }
  .row img, .ph { width: 46px; height: 62px; object-fit: cover; border-radius: 6px; background: var(--line); flex: none; }
  .t { flex: 1; min-width: 0; display: grid; }
  select { width: auto; margin: 0; }
  .choice { display: flex; gap: 6px; }
  .choice button { flex: 1; margin: 0; background: var(--surface); color: var(--text); border: 1px solid var(--line); }
  .choice button.on { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 700; }
  .go, .sheet .secondary { margin: 0; width: 100%; }
  .bar { height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 0.3s; }
</style>
