import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// Isolate module/OS mocks so the other server tests still exercise their own imports.
test("installed startup defaults on once and preserves user and OS opt-outs", () => {
  const fixture = mkdtempSync(join(tmpdir(), "systo-login-"));
  try {
    // Bun inlines node:os.homedir; bind that boundary to the fixture before loading.
    const modulePath = join(fixture, "autostart.ts");
    const source = readFileSync(join(process.cwd(), "src/lib/server/autostart.ts"), "utf8")
      .replace('import { homedir, userInfo } from "node:os";', `const homedir = () => ${JSON.stringify(fixture)}; const userInfo = () => ({ uid: 501 });`)
      .replace('"./exec"', JSON.stringify(pathToFileURL(join(process.cwd(), "src/lib/server/exec.ts")).href))
      .replace('"./paths"', JSON.stringify(pathToFileURL(join(process.cwd(), "src/lib/server/paths.ts")).href));
    writeFileSync(modulePath, source);
    const result = spawnSync(process.execPath, ["-e", `
      import { mock, expect } from "bun:test";
      import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
      import { join, dirname } from "node:path";
      const fixture = ${JSON.stringify(fixture)};
      const calls = [];
      let disabled = false;
      mock.module("./src/lib/server/paths", () => ({ appDataFile: name => join(fixture, name) }));
      mock.module("./src/lib/server/exec", () => ({
        output: async () => disabled ? '"dev.systo.monitor.login" => disabled' : '',
        run: async (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: '', stderr: '' }; }
      }));
      Object.defineProperty(process, "platform", { value: "darwin" });
      Object.defineProperty(process, "execPath", { value: "/Applications/Systo.app/Contents/MacOS/bun" });
      const { initializeAutostart, autostartState, setAutostart } = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
      const plist = join(fixture, "Library/LaunchAgents/dev.systo.monitor.login.plist");
      const preference = join(fixture, "autostart.json");
      await initializeAutostart();
      expect((await autostartState()).enabled).toBe(true);
      expect(readFileSync(plist, "utf8")).toContain("<string>--background</string>");
      expect(readFileSync(plist, "utf8")).toContain("<string>-g</string>");
      const registeredCalls = calls.length;
      await initializeAutostart();
      expect(calls.length).toBe(registeredCalls);
      await setAutostart(false);
      await initializeAutostart();
      expect(existsSync(plist)).toBe(false);
      // An existing registration disabled in macOS must remain disabled on upgrade.
      rmSync(preference);
      mkdirSync(dirname(plist), { recursive: true });
      writeFileSync(plist, "existing registration");
      disabled = true;
      const before = calls.length;
      await initializeAutostart();
      expect((await autostartState()).enabled).toBe(false);
      expect(calls.length).toBe(before);
      expect(readFileSync(plist, "utf8")).toBe("existing registration");
      // A dev session never installs a login item or consumes first-run initialization.
      rmSync(preference);
      Object.defineProperty(process, "execPath", { value: "/usr/local/bin/bun" });
      await initializeAutostart();
      expect(existsSync(preference)).toBe(false);
      // Linux uses the same default and remembers both Settings and XDG opt-outs.
      delete process.env.APPIMAGE;
      process.env.XDG_CONFIG_HOME = join(fixture, "config");
      const bin = join(fixture, "bin", "bun").split(String.fromCharCode(92)).join("/");
      mkdirSync(dirname(bin), { recursive: true });
      writeFileSync(join(dirname(bin), "launcher"), "fixture");
      Object.defineProperty(process, "platform", { value: "linux" });
      Object.defineProperty(process, "execPath", { value: bin });
      const entry = join(fixture, "config", "autostart", "dev.systo.monitor.desktop");
      await initializeAutostart();
      expect((await autostartState()).enabled).toBe(true);
      expect(readFileSync(entry, "utf8")).toContain("--background");
      await setAutostart(false);
      await initializeAutostart();
      expect(existsSync(entry)).toBe(false);
      rmSync(preference);
      writeFileSync(entry, "[Desktop Entry]\\nHidden=true\\n");
      await initializeAutostart();
      expect((await autostartState()).enabled).toBe(false);
    `], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("desktop runtime keeps the tray process alive after the last window closes", async () => {
  const { createElectrobunConfig } = await import("../node_modules/@farm.js/desktop/dist/electrobun/templates.js");
  const config = createElectrobunConfig({
    root: process.cwd(), shellDir: "/tmp/systo-shell", serverDir: "/tmp/systo-server",
    desktop: { name: "Systo", id: "dev.systo.monitor", version: "0.1.2" },
  });
  expect(config).toContain('"exitOnLastWindowClosed": false');
});
