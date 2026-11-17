import { expect, test, mock } from "bun:test";

const created: FakeWindow[] = [];
const frames: number[][] = [];
const closedPanels: number[] = [];
const raisedPanels: number[] = [];
let geometries = [
  {
    frame: { x: 0, y: 0, width: 1440, height: 900 },
    notchHeight: 32,
    notchLeft: 620,
    notchRight: 820,
    menuBarHeight: 32,
    primaryHeight: 900,
  },
];
class FakeWindow {
  ptr = created.length + 1;
  closed = false;
  webview = { setNavigationRules() {}, on() {}, executeJavascript() {}, loadURL() {} };
  constructor(public options: unknown) {
    created.push(this);
  }
  on() {}
  close() {
    this.closed = true;
  }
}
mock.module("electrobun/main", () => ({
  BrowserWindow: FakeWindow,
  Screen: { getCursorScreenPoint: () => ({ x: 0, y: 500 }) },
}));
mock.module("../src/shell/objc", () => ({
  screenGeometries: () => geometries,
  makeOverlay: (handle: number) => handle + 100,
  closeOverlay: (handle: number) => closedPanels.push(handle),
  orderFront: (handle: number) => raisedPanels.push(handle),
  setClickThrough() {},
  setFrame: (...args: number[]) => frames.push(args),
}));

test("island controller keeps one primary-display overlay across app switches and display changes", async () => {
  const { IslandController } = await import("../src/shell/island");
  const originalSet = globalThis.setInterval,
    originalClear = globalThis.clearInterval;
  const callbacks = new Map<number, () => void>();
  let nextId = 0;
  globalThis.setInterval = ((callback: () => void, ms: number) => {
    const id = ++nextId;
    if (ms === 3000) callbacks.set(id, callback);
    return id;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((id: number) => {
    callbacks.delete(id);
  }) as unknown as typeof clearInterval;
  const controller = new IslandController("http://localhost:3109", () => {});
  try {
    controller.show();
    expect(created).toHaveLength(1);
    expect(controller.notch).toBe(true);
    expect(frames[0][0]).toBe(101);
    expect(raisedPanels).toEqual([101]);
    const sync = [...callbacks.values()][0];
    geometries = [
      ...geometries,
      {
        frame: { x: 1440, y: 0, width: 1920, height: 1080 },
        notchHeight: 0,
        notchLeft: 0,
        notchRight: 0,
        menuBarHeight: 24,
        primaryHeight: 900,
      },
    ];
    sync();
    expect(created).toHaveLength(1);
    expect(created[0].options).toMatchObject({ activate: false });
    geometries = [geometries[1]];
    sync();
    expect(created).toHaveLength(1);
    expect(frames.at(-1)?.[1]).toBe(2170);
    expect(controller.notch).toBe(false);
    controller.hide();
    expect(created[0].closed).toBe(true);
    expect(controller.active).toBe(false);
    expect(callbacks.size).toBe(0);
    expect(closedPanels).toEqual([101]);
  } finally {
    controller.hide();
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
  }
});
