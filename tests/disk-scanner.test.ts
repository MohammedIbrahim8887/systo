import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createDiskScanner } from "../src/lib/server/disk-worker";
import ts from "typescript";

/** Optionally exercise the actual minified release function with its bundled Bun runtime. */
function scannerSource() {
  if (!process.env.SYSTO_SCANNER_BUNDLE) return createDiskScanner.toString();
  const ast = ts.createSourceFile("bundle.js", readFileSync(process.env.SYSTO_SCANNER_BUNDLE, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let source = "";
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "createDiskScanner") source = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!source) throw new Error("The release bundle has no disk scanner function");
  return source;
}

test("serialized disk scanner retains native buffers across GC and repeated requests", () => {
  const root = mkdtempSync(join(tmpdir(), "systo-scanner-"));
  try {
    mkdirSync(join(root, "nested"));
    const paths = [join(root, "sample.bin"), join(root, "nested", "sample.bin")];
    for (const path of paths) writeFileSync(path, Buffer.alloc(2 * 1024 * 1024, 1));
    const expected = paths.reduce((sum, path) => {
      const stat = statSync(path);
      return sum + (process.platform === "win32" ? stat.size : stat.blocks * 512);
    }, 0);
    const request = { id: 1, path: root, mode: "tree", dev: statSync(root).dev, minKeep: 0, maxChildren: 200 };
    const source = `
      const scan = (${scannerSource()})(process.platform === 'darwin' ? require('bun:ffi') : null, require('node:fs'));
      require('node:readline').createInterface({input:process.stdin}).on('line', line => {
        Bun.gc(true);
        console.log(JSON.stringify(scan(JSON.parse(line), () => {})));
      });
    `;
    const child = spawnSync(process.env.SYSTO_TEST_BUN || process.execPath, ["--smol", "-e", source], {
      input: (JSON.stringify(request) + "\n").repeat(3), encoding: "utf8", timeout: 15000,
    });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    const results = child.stdout.trim().split("\n").map(line => JSON.parse(line));
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.denied).toBe(0);
      expect(result.files).toBe(2);
      expect(result.bytes).toBe(expected);
      expect(result.node.s).toBe(expected);
      expect(result.node.c.find((node: { n: string }) => node.n === "nested").s).toBe(expected / 2);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
