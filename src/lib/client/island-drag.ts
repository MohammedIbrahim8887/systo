import { type PointerEvent } from "react";
import { postShellCommand } from "./shell";

/** Keep one shell request in flight. Merge consecutive moves while preserving each release. */
export function createIslandDragHandlers() {
  let pointer: { id: number; x: number; y: number } | null = null;
  const queue: Array<{ dx: number; dy: number; done: boolean }> = [];
  let sending = false;

  async function send(dx: number, dy: number, done: boolean) {
    const last = queue[queue.length - 1];
    if (last && !last.done) {
      last.dx += dx;
      last.dy += dy;
      last.done = done;
    } else {
      queue.push({ dx, dy, done });
    }
    if (sending) return;
    sending = true;
    try {
      while (queue.length) {
        const move = queue.shift()!;
        const command = { type: "drag-island", ...move } as const;
        const nonce = Math.random().toString(36).slice(2);
        try {
          await postShellCommand(command, nonce);
        } catch {
          // The shell deduplicates by nonce if only the response was lost.
          await postShellCommand(command, nonce).catch(() => {});
        }
      }
    } finally {
      sending = false;
    }
  }

  function update(event: PointerEvent, done: boolean) {
    const p = pointer;
    if (p?.id !== event.pointerId) return;
    const dx = event.screenX - p.x;
    const dy = event.screenY - p.y;
    p.x = event.screenX;
    p.y = event.screenY;
    if (done) pointer = null;
    if (dx || dy || done) void send(dx, dy, done);
  }

  function cancel(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    void send(0, 0, true);
  }

  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      const target = event.target;
      if (pointer || event.button !== 0 || !event.isPrimary || !(target instanceof Element) ||
        !target.closest("[data-island-grip]") || target.closest("button")) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointer = { id: event.pointerId, x: event.screenX, y: event.screenY };
      event.preventDefault();
      void send(0, 0, false);
    },
    onPointerMove: (event: PointerEvent) => update(event, false),
    onPointerUp: (event: PointerEvent) => update(event, true),
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
}
