import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// Moves files around a fixture home folder, so it never touches the real Trash. Finder and gio
// are made to fail, which exercises the fallback that moves items into the Trash directly.
test.skipIf(process.platform === "win32")("trashMany moves a selection and folder contents in one go", () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "systo-trash-")));
  try {
    const home = join(fixture, "home");
    const mb = Buffer.alloc(2 * 1024 * 1024, 1);
    for (const dir of ["proj/a/inner", "proj/b", "proj/keep", "cache/x", "cache/y", "Downloads", ".Trash", ".local/share/Trash"]) mkdirSync(join(home, dir), { recursive: true });
    for (const file of ["proj/a/one.bin", "proj/a/inner/two.bin", "proj/b/three.bin", "proj/keep/four.bin", "cache/x/five.bin", "cache/y/six.bin", "Downloads/seven.bin"]) writeFileSync(join(home, file), mb);
    const child = spawnSync(process.env.SYSTO_TEST_BUN || process.execPath, ["-e", `
      import { mock, expect } from 'bun:test';
      import { join } from 'node:path';
      import { existsSync, readdirSync } from 'node:fs';
      import { spawnSync } from 'node:child_process';
      const fixture = ${JSON.stringify(fixture)};
      const home = ${JSON.stringify(home)};
      mock.module('./src/lib/server/paths', () => ({ appDataDir: () => fixture, appDataFile: name => join(fixture, name) }));
      const run = async (file, args) => {
        if (file === 'gio' || file.endsWith('osascript')) return { code: 1, stdout: '', stderr: 'disabled in tests' };
        const r = spawnSync(file, args, { encoding: 'utf8' });
        return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
      };
      mock.module('./src/lib/server/exec', () => ({ run, output: async (f, a) => (await run(f, a)).stdout }));
      const { disk } = await import('./src/lib/server/disk');
      const analyzer = disk();
      analyzer.start(home);
      const deadline = Date.now() + 5000;
      while (analyzer.state.status === 'scanning' && Date.now() < deadline) await Bun.sleep(10);
      expect(analyzer.state.status).toBe('done');

      const result = await analyzer.trashMany([join(home, 'proj/a'), join(home, 'proj/a/inner'), join(home, 'proj/b')], [join(home, 'cache')]);
      expect(result.failed).toEqual([]);
      expect(result.ok).toBe(true);
      // proj/a/inner went with proj/a; the cache folder stays, emptied.
      expect(result.moved).toBe(4);
      expect(result.freed).toBeGreaterThan(0);
      expect(existsSync(join(home, 'proj/a'))).toBe(false);
      expect(existsSync(join(home, 'proj/b'))).toBe(false);
      expect(existsSync(join(home, 'proj/keep'))).toBe(true);
      expect(existsSync(join(home, 'cache'))).toBe(true);
      expect(readdirSync(join(home, 'cache'))).toEqual([]);

      const report = await analyzer.report(join(home, 'proj'));
      expect(report.view.node.children.map(c => c.name)).toEqual(['keep']);

      const refused = await analyzer.trashMany([join(home, 'Downloads')]);
      expect(refused.ok).toBe(false);
      expect(refused.failed[0].message).toContain("won't move");
      expect(existsSync(join(home, 'Downloads'))).toBe(true);
    `], { cwd: process.cwd(), encoding: "utf8", timeout: 20000, env: { ...process.env, HOME: home, XDG_DATA_HOME: join(home, ".local", "share") } });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
