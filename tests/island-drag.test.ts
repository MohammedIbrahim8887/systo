import { expect, test } from "bun:test";
import type { PointerEvent } from "react";
import { Window } from "happy-dom";
import { createIslandDragHandlers } from "../src/lib/client/island-drag";

test("a header drag preserves its release across a lost reply and ignores other pointers and buttons", async () => {
  const browser = new Window();
  const header = browser.document.createElement("div");
  header.setAttribute("data-island-grip", "");
  const button = header.appendChild(browser.document.createElement("button"));
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  const previousFetch = globalThis.fetch;
  const attempts: Array<{ command: { dx: number; dy: number; done: boolean }; nonce: string }> = [];
  let captured = 0;
  const event = (screenX: number, target = header as typeof button | typeof header, pointerId = 1) => ({
    target, button: 0, isPrimary: true, screenX, screenY: 10, pointerId,
    currentTarget: { setPointerCapture: () => { captured++; } },
    preventDefault() {},
  }) as unknown as PointerEvent<HTMLDivElement>;
  const releaseSent = Promise.withResolvers<void>();
  try {
    Object.defineProperty(globalThis, "Element", { configurable: true, value: browser.Element });
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      attempts.push(body);
      if (attempts.length === 1) throw new Error("reply lost");
      if (body.command.done) releaseSent.resolve();
      return Response.json({ ok: true });
    }) as typeof fetch;
    const drag = createIslandDragHandlers();
    drag.onPointerDown(event(10, button));
    expect(captured).toBe(0);
    drag.onPointerDown(event(10));
    drag.onPointerCancel(event(15, header, 2));
    drag.onPointerMove(event(20));
    drag.onPointerUp(event(35));
    drag.onLostPointerCapture(event(35));
    await releaseSent.promise;
    expect(captured).toBe(1);
    expect(attempts).toHaveLength(3);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[2].command).toEqual({ type: "drag-island", dx: 25, dy: 0, done: true });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousElement) Object.defineProperty(globalThis, "Element", previousElement);
    else Reflect.deleteProperty(globalThis, "Element");
    await browser.happyDOM.close();
  }
});
