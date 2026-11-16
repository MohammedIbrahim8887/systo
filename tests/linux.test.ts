import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDesktopEntry, programOf } from "../src/lib/server/linux/apps";
import { classifyLinux, safetyLinux } from "../src/lib/server/linux/classify";
import { parseSockets } from "../src/lib/server/linux/network";
import { autostartEntries, toggleAutostart } from "../src/lib/server/linux/startup";

/** A scratch directory holding the given files, removed when the callback returns. */
function withFiles(files: Record<string, string>, body: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "systo-test-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(root, name, ".."), { recursive: true });
      writeFileSync(join(root, name), text);
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("programOf finds the program in Exec lines", () => {
  expect(programOf("/usr/bin/google-chrome-stable %U")).toBe("/usr/bin/google-chrome-stable");
  expect(programOf('"/home/a/Apps/My App.AppImage" --hidden')).toBe("/home/a/Apps/My App.AppImage");
  expect(programOf("env GDK_BACKEND=wayland FOO=1 obsidian %u")).toBe("obsidian");
});

test("parseDesktopEntry reads the main group only", () => {
  const entry = parseDesktopEntry(
    "/usr/share/applications/org.example.Foo.desktop",
    "[Desktop Entry]\nType=Application\nName=Foo\nExec=foo --bar %f\nIcon=foo\nStartupWMClass=Foo\nNoDisplay=true\nOnlyShowIn=GNOME;KDE;\n\n[Desktop Action new]\nName=New Window\nExec=foo --new\n",
  );
  expect(entry).toMatchObject({ id: "org.example.Foo", name: "Foo", program: "foo", icon: "foo", wmClass: "Foo", noDisplay: true, hidden: false, onlyShowIn: ["GNOME", "KDE"] });
  expect(parseDesktopEntry("/x/link.desktop", "[Desktop Entry]\nType=Link\nURL=https://example.com\n")).toBeNull();
});

test("classifyLinux sorts processes into the three sections", () => {
  const base = { pid: 500, uid: 1000, kthread: false, hasWindow: false, hasEntry: false };
  expect(classifyLinux({ ...base, pid: 40, uid: 0, name: "kworker/0:1", path: "", kthread: true })).toBe("kernel");
  expect(classifyLinux({ ...base, name: "chrome", path: "/opt/google/chrome/chrome", hasWindow: true })).toBe("app");
  expect(classifyLinux({ ...base, name: "1password", path: "/opt/1Password/1password", hasEntry: true })).toBe("menu-bar");
  expect(classifyLinux({ ...base, name: "python3.14", path: "/usr/bin/python3.14" })).toBe("developer");
  expect(classifyLinux({ ...base, name: "waybar", path: "/usr/bin/waybar" })).toBe("user-service");
  expect(classifyLinux({ ...base, uid: 0, name: "NetworkManager", path: "/usr/bin/NetworkManager" })).toBe("system-service");
  expect(classifyLinux({ ...base, uid: 0, name: "mullvad-daemon", path: "/opt/Mullvad VPN/resources/mullvad-daemon" })).toBe("third-party-service");
  expect(safetyLinux("systemd", "system-service", 1)).toBe("critical");
  expect(safetyLinux("Hyprland", "user-service", 1367)).toBe("critical");
  expect(safetyLinux("pipewire", "user-service", 900)).toBe("relaunches");
  expect(safetyLinux("waybar", "user-service", 901)).toBe("caution");
  expect(safetyLinux("chrome", "app", 902)).toBe("safe");
});

test("parseSockets reads per-socket byte counters and skips loopback and ownerless sockets", () => {
  const sockets = parseSockets(
    [
      'ESTAB 0 0 192.168.1.5:45052 149.154.167.99:443 users:(("firefox-bin",pid=6261,fd=244)) bbr wscale:10,10 bytes_sent:190756 bytes_retrans:2974 bytes_acked:187783 bytes_received:156259 segs_out:2100',
      'ESTAB 0 0 [2a02:1::5]:51000 [2606:4700::1]:443 users:(("chrome",pid=5310,fd=31),("chrome",pid=5311,fd=31)) cubic bytes_sent:10 bytes_acked:11 bytes_received:20',
      'ESTAB 0 0 127.0.0.1:3000 127.0.0.1:51234 users:(("node",pid=900,fd=20)) cubic bytes_sent:999 bytes_received:999',
      "ESTAB 0 0 192.168.1.5:22 192.168.1.9:50000 cubic bytes_sent:5 bytes_received:5",
    ].join("\n"),
  );
  expect([...sockets.values()]).toEqual([
    { pid: 6261, in: 156259, out: 190756 },
    { pid: 5310, in: 20, out: 10 },
  ]);
});

const SYSTEM_ENTRY = "[Desktop Entry]\nType=Application\nName=Sync\nExec=/usr/bin/sync-daemon --tray\nIcon=sync\n";

test("a user's autostart override decides, even when it has nothing to show", () => {
  withFiles(
    {
      "user/off.desktop": "[Desktop Entry]\nHidden=true\n",
      "system/off.desktop": SYSTEM_ENTRY,
      "user/elsewhere.desktop": `${SYSTEM_ENTRY}OnlyShowIn=NoSuchDesktop;\n`,
      "system/elsewhere.desktop": SYSTEM_ENTRY,
      "user/orphan.desktop": "[Desktop Entry]\nHidden=true\n",
      "system/plain.desktop": SYSTEM_ENTRY,
    },
    (root) => {
      const entries = autostartEntries([join(root, "user"), join(root, "system")]);
      expect(entries.map((e) => [e.fileName, e.enabled, e.name, e.exec]).sort()).toEqual([
        // Off, and named after the system entry the bare override turns off.
        ["off.desktop", false, "Sync", "/usr/bin/sync-daemon --tray"],
        ["plain.desktop", true, "Sync", "/usr/bin/sync-daemon --tray"],
      ]);
    },
  );
});

test("turning a bare override back on removes it instead of hiding the system entry", () => {
  withFiles({ "user/off.desktop": "[Desktop Entry]\nHidden=true\n", "system/off.desktop": SYSTEM_ENTRY }, (root) => {
    const dirs = [join(root, "user"), join(root, "system")];
    expect(toggleAutostart("off.desktop", true, dirs[0], [dirs[1]]).ok).toBe(true);
    expect(existsSync(join(dirs[0], "off.desktop"))).toBe(false);
    expect(autostartEntries(dirs).map((e) => e.enabled)).toEqual([true]);

    expect(toggleAutostart("off.desktop", false, dirs[0], [dirs[1]]).ok).toBe(true);
    expect(readFileSync(join(dirs[0], "off.desktop"), "utf8")).toContain("Hidden=true");
    expect(autostartEntries(dirs).map((e) => e.enabled)).toEqual([false]);
  });
});
