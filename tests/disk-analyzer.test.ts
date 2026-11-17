import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("worker pool reports nonzero sizes for files and nested folders", () => {
  const fixture = mkdtempSync(join(tmpdir(), "systo-scan-pool-"));
  try {
    const root = join(fixture, "scan");
    mkdirSync(join(root, "nested", "deeper"), { recursive: true });
    const file = join(root, "nested", "deeper", "sample.bin");
    writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 1));
    const stat = statSync(file);
    const expected = process.platform === "win32" ? stat.size : stat.blocks * 512;
    const child = spawnSync(process.env.SYSTO_TEST_BUN || process.execPath, ["-e", `
      import { mock, expect } from 'bun:test';
      import { join } from 'node:path';
      const fixture = ${JSON.stringify(fixture)};
      mock.module('./src/lib/server/paths', () => ({ appDataDir: () => fixture, appDataFile: name => join(fixture, name) }));
      const { disk } = await import('./src/lib/server/disk');
      const analyzer = disk();
      analyzer.start(${JSON.stringify(root)});
      const deadline = Date.now() + 5000;
      while (analyzer.state.status === 'scanning' && Date.now() < deadline) await Bun.sleep(10);
      expect(analyzer.state.status).toBe('done');
      expect(analyzer.state.stats.files).toBe(1);
      expect(analyzer.state.stats.bytes).toBe(${expected});
      expect(analyzer.state.stats.denied).toBe(0);
      const report = await analyzer.report();
      expect(report.view.node.size).toBe(${expected});
      expect(report.view.node.children[0].size).toBe(${expected});
    `], { cwd: process.cwd(), encoding: "utf8", timeout: 15000 });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
