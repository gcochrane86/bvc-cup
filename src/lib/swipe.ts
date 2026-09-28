// Swipe-left-to-delete maths (iOS style): the row slides left to reveal a REVEAL-px wide Delete button.
export const REVEAL = 88;

/** Row offset (px, ≤ 0) while dragging by dx from the open or closed position; rubber-bands past the button. */
export function dragOffset(open: boolean, dx: number): number {
  const raw = (open ? -REVEAL : 0) + dx;
  if (raw > 0) return 0;
  if (raw < -REVEAL) return -REVEAL + (raw + REVEAL) / 8;
  return raw;
}

/** Whether the row should rest open after a drag of dx: past halfway reveals Delete. */
export function settleOpen(open: boolean, dx: number): boolean {
  return dragOffset(open, dx) < -REVEAL / 2;
}
