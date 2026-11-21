import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const browser = new Window();
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "PointerEvent", "HTMLInputElement"] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? browser : (browser as any)[name] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DiskView } = await import("../src/components/systo/disk-view");
const originalFetch = globalThis.fetch;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  globalThis.fetch = originalFetch;
});

for (const status of ["done", "error"] as const) {
  test(`a scan that reaches ${status} before the first poll leaves the progress screen`, async () => {
    let started = false;
    const state = () => ({ status: started ? status : "idle", progress: { files: 0, dirs: 0, bytes: 0, current: "" }, error: started && status === "error" ? "Scanner failed" : undefined });
    globalThis.fetch = (async (_input: any, init?: RequestInit) => {
      if (init?.method === "POST") {
        started = true;
        return Response.json({ ok: true, state: state() });
      }
      return Response.json({
        state: state(), volume: { used: 0, total: 100 }, home: "/fixture",
        view: started && status === "done" ? {
          path: "/fixture", display: "/fixture", crumbs: [{ name: "Fixture", path: "/fixture" }],
          node: { name: "Fixture", path: "/fixture", size: 0, files: 0, kind: "folder", hasChildren: false, children: [] },
        } : undefined,
      });
    }) as typeof fetch;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root!.render(<DiskView />); });
    const home = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Home folder"))!;
    expect(home).toBeDefined();
    await act(async () => { home.click(); });
    expect(started).toBe(true);
    expect(container.textContent).not.toContain("Several readers work in parallel");
    if (status === "error") expect(container.querySelector('[role="alert"]')?.textContent).toBe("Scanner failed");
    else expect(container.textContent).toContain("Largest files");
  });
}

test("cleanup suggestions can be selected together and moved in one request", async () => {
  const posts: any[] = [];
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true, moved: 3, freed: 600, failed: [], message: "Moved 3 items to the Trash." });
    }
    return Response.json({
      state: { status: "done", finishedAt: Date.now(), label: "Home", root: "/fixture", progress: { files: 0, dirs: 0, bytes: 0, current: "" } },
      volume: { used: 0, total: 100 }, home: "/fixture",
      view: { path: "/fixture", display: "/fixture", crumbs: [{ name: "Fixture", path: "/fixture" }], node: { name: "Fixture", path: "/fixture", size: 0, files: 0, kind: "folder", hasChildren: false, children: [] } },
      suggestions: [
        { id: "caches", title: "App caches", description: "", path: "/fixture/Library/Caches", size: 300, safe: true },
        { id: "dev-folders", title: "Dependency and build folders", description: "", size: 300, count: 2, safe: true, items: [{ path: "/fixture/a/node_modules", size: 200 }, { path: "/fixture/b/node_modules", size: 100 }] },
        { id: "downloads", title: "Downloads", description: "", path: "/fixture/Downloads", size: 900, safe: false },
      ],
    });
  }) as typeof fetch;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const { TooltipProvider } = await import("../src/components/ui/tooltip");
  await act(async () => { root!.render(<TooltipProvider><DiskView /></TooltipProvider>); });
  const button = (text: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim().startsWith(text))!;
  // Radix tabs switch when a trigger takes focus.
  await act(async () => { button("Cleanup").focus(); });
  await act(async () => { button("Select all safe").click(); });
  expect(container.textContent).toContain("3 selected");
  await act(async () => { button("Move to").click(); });
  expect(document.body.textContent).toContain("Move 3 items to the");
  expect(document.body.textContent).toContain("Everything in App caches");
  const confirm = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(b => b.textContent?.startsWith("Move to"))! as HTMLButtonElement;
  await act(async () => { confirm.click(); });
  expect(posts).toEqual([{ action: "trash-many", paths: ["/fixture/a/node_modules", "/fixture/b/node_modules"], contents: ["/fixture/Library/Caches"] }]);
});
