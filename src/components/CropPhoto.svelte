<script lang="ts">
  // Crop a photo before it uploads: drag the frame, drag its corner to resize, pick a shape, rotate.
  import { untrack } from 'svelte';
  import { clampBox, FULL, lockRatio, type Box } from '../lib/crop';
  import { turnCanvas } from '../lib/guidePhotos';

  let {
    file,
    title,
    count = '',
    onUse,
    onSkip,
    onCancel,
  }: {
    file: Blob;
    /** e.g. "Hole 7 photo". */
    title: string;
    /** e.g. "1 of 2" when several were picked. */
    count?: string;
    /** The frame (fractions of the turned photo) and the quarter turns. */
    onUse: (box: Box, turns: number) => void;
    /** Upload as it is. */
    onSkip: () => void;
    onCancel: () => void;
  } = $props();

  const SHAPES = [
    { label: 'Free', ratio: 0 },
    { label: 'Landscape', ratio: 4 / 3 },
    { label: 'Portrait', ratio: 3 / 4 },
    { label: 'Square', ratio: 1 },
  ];
  let bmp = $state<ImageBitmap | null>(null);
  let turns = $state(0);
  let ratio = $state(0);
  let box = $state<Box>({ ...FULL });
  let canvas = $state<HTMLCanvasElement | null>(null);
  let error = $state<string | null>(null);
  const size = $derived(bmp ? (turns % 2 ? { w: bmp.height, h: bmp.width } : { w: bmp.width, h: bmp.height }) : { w: 4, h: 3 });

  // Load the photo (phone rotation applied), then show it, turned, on the preview canvas.
  $effect(() => {
    const f = file;
    let gone = false;
    untrack(() => {
      bmp = null;
      turns = 0;
      ratio = 0;
      box = { ...FULL };
    });
    createImageBitmap(f, { imageOrientation: 'from-image' }).then(
      (b) => (gone ? b.close() : (bmp = b)),
      () => (error = "Couldn't open this photo."),
    );
    return () => (gone = true);
  });
  $effect(() => {
    if (!bmp || !canvas) return;
    const turned = turnCanvas(bmp, turns);
    const scale = Math.min(1, 1000 / Math.max(turned.width, turned.height)); // a light preview
    canvas.width = Math.round(turned.width * scale);
    canvas.height = Math.round(turned.height * scale);
    canvas.getContext('2d')?.drawImage(turned, 0, 0, canvas.width, canvas.height);
  });

  function shape(r: number) {
    ratio = r;
    box = lockRatio(r ? { ...box, x: 0, y: 0, w: 1 } : box, r, size.w, size.h);
    if (r) box = clampBox({ ...box, x: (1 - box.w) / 2, y: (1 - box.h) / 2 }); // centred
  }
  function rotate() {
    turns = (turns + 1) % 4;
    box = ratio ? lockRatio({ x: 0, y: 0, w: 1, h: 1 }, ratio, size.w, size.h) : { ...FULL };
    if (ratio) box = clampBox({ ...box, x: (1 - box.w) / 2, y: (1 - box.h) / 2 });
  }
  function reset() {
    turns = 0;
    ratio = 0;
    box = { ...FULL };
  }

  // Dragging: move the frame, or resize it from the corner handle.
  let area = $state<HTMLDivElement | null>(null);
  let drag: { mode: 'move' | 'size'; x: number; y: number; b: Box } | null = null;
  function down(e: PointerEvent, mode: 'move' | 'size') {
    e.stopPropagation();
    drag = { mode, x: e.clientX, y: e.clientY, b: { ...box } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag || !area) return;
    const r = area.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / r.width;
    const dy = (e.clientY - drag.y) / r.height;
    if (drag.mode === 'move') box = clampBox({ ...drag.b, x: drag.b.x + dx, y: drag.b.y + dy });
    else box = lockRatio(clampBox({ ...drag.b, w: drag.b.w + dx, h: drag.b.h + dy }), ratio, size.w, size.h);
  }
  const up = () => (drag = null);
</script>

<div class="shade">
  <div class="sheet" role="dialog" aria-label="Crop {title.toLowerCase()}">
    <div class="top"><strong>{title}</strong>{#if count}<span>{count}</span>{/if}</div>
    {#if error}
      <p class="err">{error}</p>
    {:else}
      <div class="stage">
        <div class="area" bind:this={area} style="aspect-ratio: {size.w} / {size.h}">
          <canvas bind:this={canvas} aria-hidden="true"></canvas>
          <div
            class="frame"
            data-testid="crop-frame"
            role="application"
            aria-label="Crop frame: drag to move, drag the corner to resize"
            style="left:{box.x * 100}%; top:{box.y * 100}%; width:{box.w * 100}%; height:{box.h * 100}%"
            onpointerdown={(e) => down(e, 'move')}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
          >
            <span class="handle" aria-hidden="true" onpointerdown={(e) => down(e, 'size')} onpointermove={move} onpointerup={up} onpointercancel={up}></span>
          </div>
        </div>
      </div>
    {/if}
    <div class="chips">
      {#each SHAPES as s (s.label)}
        <button class="chip" class:on={ratio === s.ratio} aria-pressed={ratio === s.ratio} onclick={() => shape(s.ratio)}>{s.label}</button>
      {/each}
    </div>
    <div class="tools">
      <button class="tool" onclick={rotate}>↻ Rotate</button>
      <button class="tool" onclick={reset}>Reset</button>
      <button class="use" disabled={!bmp} onclick={() => onUse(box, turns)}>Use photo</button>
    </div>
    <div class="links">
      <button class="link" onclick={onCancel}>Cancel</button>
      <button class="link" onclick={onSkip}>Upload without cropping</button>
    </div>
  </div>
</div>

<style>
  .shade { position: fixed; inset: 0; z-index: 60; background: rgb(0 0 0 / 0.6); display: flex; align-items: center; justify-content: center; padding: 12px; }
  .sheet { background: #0e1512; color: #f1f5f2; width: 100%; max-width: 560px; max-height: 100%; overflow: auto; border-radius: 18px; padding: 14px 14px calc(14px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 10px; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  .top span { opacity: 0.75; font-size: 0.85rem; }
  .err { color: #ffb4a8; }
  .stage { display: flex; justify-content: center; background: #000; border-radius: 10px; padding: 6px; }
  .area { position: relative; max-width: 100%; max-height: 58vh; width: 100%; touch-action: none; user-select: none; }
  .area canvas { width: 100%; height: 100%; display: block; }
  .frame { position: absolute; border: 2px solid #fff; box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55); cursor: move; touch-action: none; }
  .handle { position: absolute; right: -11px; bottom: -11px; width: 22px; height: 22px; border-radius: 50%; background: #fff; cursor: nwse-resize; touch-action: none; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { margin: 0; min-height: 0; border: 1px solid rgb(255 255 255 / 0.35); background: transparent; color: #f1f5f2; border-radius: 999px; padding: 6px 12px; font-size: 0.85rem; }
  .chip.on { background: #f1f5f2; color: #0e1512; border-color: #f1f5f2; font-weight: 700; }
  .tools { display: flex; gap: 8px; align-items: center; }
  .tool { margin: 0; background: transparent; color: #f1f5f2; border: 1px solid rgb(255 255 255 / 0.35); }
  .use { margin: 0 0 0 auto; background: #7fc8a0; color: #0d1a13; font-weight: 800; }
  .links { display: flex; justify-content: space-between; }
  .link { margin: 0; min-height: 0; background: none; color: #c9d6cf; padding: 4px 0; font-size: 0.85rem; text-decoration: underline; }
</style>
