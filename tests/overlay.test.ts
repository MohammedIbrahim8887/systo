import { expect, test } from "bun:test";
import { configureOverlay } from "../src/shell/overlay-policy";

test("the island joins other applications, Spaces and full-screen windows without hiding on deactivation", () => {
  const values = new Map<string, number | boolean>();
  configureOverlay((key, value) => values.set(key, value));
  const behavior = values.get("setCollectionBehavior:") as number;
  expect(behavior & (1 << 0)).toBeTruthy();
  expect(behavior & (1 << 8)).toBeTruthy();
  expect(behavior & (1 << 18)).toBeTruthy();
  expect(values.get("setHidesOnDeactivate:")).toBe(false);
  expect(values.get("setLevel:")).toBeGreaterThan(24);
});

