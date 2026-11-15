// CI: run the Windows "Open at sign-in" toggle against the installed app. Usage: bun scripts/win-autostart-test.ts <path to installed bun.exe>
Object.defineProperty(process, "execPath", { value: process.argv[2] });
const { autostartState, setAutostart } = await import("../src/lib/server/autostart");
const { execFileSync } = await import("node:child_process");
const query = () => {
  try {
    return execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "Systo"]).toString().trim().split("\n").pop();
  } catch {
    return "(no value)";
  }
};
let failed = false;
const check = (label: string, ok: boolean, detail: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`, JSON.stringify(detail));
  if (!ok) failed = true;
};
const initial = await autostartState();
check("available", initial.available, initial);
const on = await setAutostart(true);
check("turn on", on.enabled, { on, run: query() });
execFileSync("reg.exe", ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run", "/v", "Systo", "/t", "REG_BINARY", "/d", "030000000000000000000000", "/f"]);
const blocked = await autostartState();
check("off in Task Manager reads as off", !blocked.enabled, blocked);
const again = await setAutostart(true);
check("turn back on", again.enabled, again);
const off = await setAutostart(false);
check("turn off", !off.enabled, { off, run: query() });
process.exit(failed ? 1 : 0);
