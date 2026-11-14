import { expect, test } from "bun:test";
import { programOf } from "../src/lib/server/win/startup";
import { classifyWin, safetyWin } from "../src/lib/server/win/classify";

test("programOf finds the executable in Run commands", () => {
  expect(programOf('"C:\\Program Files\\Slack\\slack.exe" --startup')).toBe("C:\\Program Files\\Slack\\slack.exe");
  expect(programOf("C:\\Program Files\\Foo Bar\\foo.exe /min")).toBe("C:\\Program Files\\Foo Bar\\foo.exe");
  expect(programOf("rundll32.exe shell32.dll,Control_RunDLL")).toBe("rundll32.exe");
});

test("classifyWin mirrors Task Manager's sections", () => {
  const base = { pid: 100, session: 1, hasWindow: false };
  expect(classifyWin({ ...base, pid: 4, exe: "System", path: "" })).toBe("kernel");
  expect(classifyWin({ ...base, exe: "chrome.exe", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", hasWindow: true })).toBe("app");
  expect(classifyWin({ ...base, exe: "explorer.exe", path: "C:\\Windows\\explorer.exe", hasWindow: true })).toBe("system-app");
  expect(classifyWin({ ...base, exe: "svchost.exe", path: "C:\\Windows\\System32\\svchost.exe", session: 0 })).toBe("system-service");
  expect(classifyWin({ ...base, exe: "node.exe", path: "C:\\Program Files\\nodejs\\node.exe" })).toBe("developer");
  expect(classifyWin({ ...base, exe: "OneDrive.exe", path: "C:\\Users\\a\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" })).toBe("menu-bar");
  expect(safetyWin("csrss.exe", "system-service", 0)).toBe("critical");
  expect(safetyWin("explorer.exe", "system-app", 1)).toBe("relaunches");
});
