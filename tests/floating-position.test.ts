import { expect, test } from "bun:test";
import { FloatingPosition, type IslandPosition } from "../src/shell/floating-position";

const area = { left: -1200, top: 40, right: 0, bottom: 940 };

test("the floating island starts at top center and restores a dropped position on a resized display", () => {
  let saved: IslandPosition | undefined;
  const position = new FloatingPosition(undefined, (p) => { saved = p; });
  expect(position.layout(area, 400, 300)).toEqual({ x: -800, y: 40 });
  expect(position.layout(area, 400, 300, -200, 300)).toEqual({ x: -1000, y: 340 });
  position.finish();
  const restored = new FloatingPosition(saved);
  expect(restored.layout({ ...area, right: 800, bottom: 1540 }, 400, 300)).toEqual({ x: -800, y: 640 });
});

test("dragging against the work area edges keeps the expanded controls reachable", () => {
  const position = new FloatingPosition();
  expect(position.layout(area, 400, 300, 9000, 9000)).toEqual({ x: -400, y: 640 });
  expect(position.layout(area, 400, 300, -9000, -9000)).toEqual({ x: -1200, y: 40 });
});
