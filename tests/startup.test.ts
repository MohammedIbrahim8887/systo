import { test, expect, mock } from 'bun:test';
import { writeFileSync } from 'node:fs';
let dumps = 0;
mock.module('../src/lib/server/exec', () => ({
  output: async () => '',
  run: async (cmd: string, args: string[]) => {
    if (args.some(a => a.includes('sfltool dumpbtm'))) {
      dumps++;
      writeFileSync(args[4], '');
    }
    return { code: 0, stdout: cmd.endsWith('osascript') ? '[]' : '', stderr: '' };
  },
}));
mock.module('../src/lib/server/sampler', () => ({ sampler: () => ({ current: async () => ({ groups: [] }) }) }));
const { startupReport, warmStartup } = await import('../src/lib/server/startup');
test('ordinary startup reads and warmup never invoke sfltool', async () => {
  warmStartup();
  await startupReport();
  await startupReport();
  expect(dumps).toBe(0);
});
