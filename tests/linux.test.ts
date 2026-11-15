import { expect, test } from "bun:test";
import { parseDesktopEntry, programOf } from "../src/lib/server/linux/apps";
import { classifyLinux, safetyLinux } from "../src/lib/server/linux/classify";
import { parseSockets } from "../src/lib/server/linux/network";

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
