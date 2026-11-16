import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const browser = new Window();
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
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
