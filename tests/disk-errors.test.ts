import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("scanner exceptions are errors, not successful empty scans", () => {
  const fixture = mkdtempSync(join(tmpdir(), "systo-scan-error-"));
  try {
    const child = spawnSync(process.env.SYSTO_TEST_BUN || process.execPath, ["-e", `
      import { mock, expect } from 'bun:test';
      import { join } from 'node:path';
      const fixture = ${JSON.stringify(fixture)};
      mock.module('./src/lib/server/paths', () => ({ appDataDir: () => fixture, appDataFile: name => join(fixture, name) }));
      mock.module('./src/lib/server/disk-worker', () => ({
        createDiskScanner: function createDiskScanner() {
          return function scan() { throw new Error('scanner failure fixture'); };
        }
      }));
      const { disk } = await import('./src/lib/server/disk');
      const analyzer = disk();
      analyzer.start(fixture);
      const deadline = Date.now() + 5000;
      while (analyzer.state.status === 'scanning' && Date.now() < deadline) await Bun.sleep(10);
      expect(analyzer.state.status).toBe('error');
      expect(analyzer.state.error).toContain('scanner failure fixture');
      expect(analyzer.state.stats).toBeUndefined();
    `], { cwd: process.cwd(), encoding: "utf8", timeout: 10000 });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
