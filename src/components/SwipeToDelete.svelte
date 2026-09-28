<script lang="ts">
  import type { Snippet } from 'svelte';
  import { REVEAL, dragOffset, settleOpen } from '../lib/swipe';

  // iOS-style row: swipe left to reveal a red Delete button behind it.
  let { label, onDelete, children }: { label: string; onDelete: () => void; children: Snippet } = $props();

  let open = $state(false);
  let offset = $state(0);
  let dragging = $state(false);
  let start: { x: number; y: number; id: number } | null = null;
  let horizontal = false;
  let justDragged = false;

  function down(e: PointerEvent) {
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    horizontal = false;
  }
  function move(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!horizontal) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return; // let vertical scrolling happen
      horizontal = true;
      dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    offset = dragOffset(open, dx);
  }
  function up(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    if (horizontal) {
      open = settleOpen(open, e.clientX - start.x);
      justDragged = true;
      setTimeout(() => (justDragged = false), 0);
    }
    offset = open ? -REVEAL : 0;
    dragging = false;
    start = null;
  }
  // A drag must not also count as a tap on the row; tapping an open row just closes it.
  function click(e: MouseEvent) {
    if (justDragged || open) {
      e.preventDefault();
      e.stopPropagation();
      if (!justDragged) {
        open = false;
        offset = 0;
      }
    }
  }
  function remove() {
    open = false;
    offset = 0;
    onDelete();
  }
</script>

<div class="swipe" data-testid="swipe-row">
  <button class="delete" style="width:{REVEAL}px" tabindex={open ? 0 : -1} aria-hidden={!open} aria-label="Delete {label}" onclick={remove}>
    Delete
  </button>
  <div
    class="front"
    class:dragging
    style="margin-right:{-offset}px"
    role="presentation"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onclickcapture={click}
  >
    {@render children()}
  </div>
</div>

<style>
  .swipe { position: relative; overflow: hidden; border-radius: var(--radius); margin-bottom: 12px; background: var(--danger); }
  .delete {
    position: absolute; top: 0; right: 0; bottom: 0; border-radius: 0;
    background: var(--danger); color: #fff; font-weight: 700; padding: 0;
  }
  /* The row narrows from the right (rather than sliding) so the event name stays readable. */
  .front { position: relative; touch-action: pan-y; transition: margin-right 0.2s ease-out; background: var(--bg); }
  .front :global(.card) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .front.dragging { transition: none; }
  .front :global(.card) { margin: 0; }
  @media (prefers-reduced-motion: reduce) { .front { transition: none; } }
</style>
