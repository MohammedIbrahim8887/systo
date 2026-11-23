import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  actionTitle,
  checkCombo,
  comboFromEvent,
  comboId,
  comboLabel,
  findConflicts,
  keyFromCode,
  normalizeUrl,
  sanitizeAction,
  sanitizeCombo,
  toAccelerator,
  type Hotkey,
  type KeyCombo,
} from "../src/lib/hotkeys";
import {
  decodeGsettings,
  decodeHyprBinds,
  decodeKdeShortcuts,
  decodeMacSymbolic,
  parseGtkAccelerator,
  parseKdeShortcut,
} from "../src/lib/server/hotkeys/system";
import { loadHotkeys, saveHotkeys } from "../src/lib/server/hotkeys/store";

const press = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

test("reads keys by position, so ⌥ doesn't turn K into ˚", () => {
  expect(comboFromEvent({ ...press("KeyK", { altKey: true, metaKey: true }), key: "˚" })).toEqual({ mods: ["alt", "meta"], key: "K" });
  expect(keyFromCode("Digit7")).toBe("7");
  expect(keyFromCode("Numpad3")).toBe("3");
  expect(keyFromCode("F13")).toBe("F13");
  expect(keyFromCode("ArrowLeft")).toBe("Left");
  expect(keyFromCode("Enter")).toBe("Return");
  expect(keyFromCode("Comma")).toBe(",");
  expect(keyFromCode("MetaLeft")).toBe("");
  expect(keyFromCode("AudioVolumeUp")).toBe("");
});

test("labels follow each platform's conventions", () => {
  const combo: KeyCombo = { mods: ["ctrl", "alt", "shift", "meta"], key: "T" };
  expect(comboLabel(combo, "mac")).toBe("⌃⌥⇧⌘T");
  expect(comboLabel(combo, "windows")).toBe("Win+Ctrl+Alt+Shift+T");
  expect(comboLabel(combo, "linux")).toBe("Super+Ctrl+Alt+Shift+T");
  expect(comboLabel({ mods: ["meta"], key: "Return" }, "mac")).toBe("⌘↩");
  expect(comboLabel({ mods: ["ctrl"], key: "Return" }, "windows")).toBe("Ctrl+Enter");
});

test("builds Electrobun accelerators", () => {
  expect(toAccelerator({ mods: ["alt", "meta"], key: "T" }, "mac")).toBe("Alt+Command+T");
  expect(toAccelerator({ mods: ["meta", "shift"], key: "Space" }, "linux")).toBe("Shift+Super+Space");
  expect(toAccelerator({ mods: ["ctrl", "alt"], key: "-" }, "windows")).toBe("Control+Alt+minus");
});

test("refuses combos that would take over ordinary typing", () => {
  expect(checkCombo({ mods: [], key: "K" }, "mac").ok).toBe(false);
  expect(checkCombo({ mods: ["shift"], key: "K" }, "windows").ok).toBe(false);
  expect(checkCombo({ mods: ["alt"], key: "E" }, "mac").ok).toBe(false);
  expect(checkCombo({ mods: ["alt"], key: "E" }, "windows").ok).toBe(true);
  expect(checkCombo({ mods: ["alt"], key: "3" }, "mac").ok).toBe(true);
  expect(checkCombo({ mods: [], key: "F13" }, "mac").ok).toBe(true);
  expect(checkCombo({ mods: ["meta", "shift"], key: "K" }, "mac").ok).toBe(true);
  expect(checkCombo({ mods: ["meta"], key: "" }, "mac").ok).toBe(false);
});

test("normalizes web addresses and refuses other schemes", () => {
  expect(normalizeUrl("github.com/notifications")).toBe("https://github.com/notifications");
  expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  expect(normalizeUrl("mailto:me@example.com")).toBe("mailto:me@example.com");
  expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  expect(normalizeUrl("file:///etc/passwd")).toBeNull();
  expect(normalizeUrl("notaurl")).toBeNull();
});

test("sanitizes what arrives from the page", () => {
  expect(sanitizeCombo({ mods: ["meta", "bogus", "alt"], key: "T" })).toEqual({ mods: ["alt", "meta"], key: "T" });
  expect(sanitizeCombo({ mods: [], key: "rm -rf" })).toBeNull();
  expect(sanitizeAction({ type: "url", url: "example.com" })).toEqual({ type: "url", url: "https://example.com/" });
  expect(sanitizeAction({ type: "systo", command: "quit" })).toBeNull();
  expect(sanitizeAction({ type: "command", command: "   " })).toBeNull();
});

test("titles read like what the shortcut opens", () => {
  expect(actionTitle({ type: "app", path: "/Applications/Safari.app", name: "" })).toBe("Safari");
  expect(actionTitle({ type: "url", url: "https://www.github.com/" })).toBe("github.com");
  expect(actionTitle({ type: "path", path: "/Users/me/Downloads" })).toBe("Downloads");
  expect(actionTitle({ type: "systo", command: "open-main" })).toBe("Show Systo");
});

test("finds clashes with your own and the system's shortcuts", () => {
  const mine: Hotkey = { id: "a", combo: { mods: ["alt", "meta"], key: "T" }, action: { type: "url", url: "https://a.dev/" }, enabled: true, createdAt: 0 };
  const spotlight = { id: "s", name: "Show Spotlight search", group: "Spotlight", owner: "macOS", combo: { mods: ["meta" as const], key: "Space" } };
  expect(findConflicts({ mods: ["meta", "alt"], key: "t" }, [mine], []).own?.id).toBe("a");
  expect(findConflicts({ mods: ["meta", "alt"], key: "T" }, [mine], [], "a").own).toBeUndefined();
  expect(findConflicts({ mods: ["meta"], key: "Space" }, [mine], [spotlight]).system).toHaveLength(1);
  expect(comboId({ mods: ["meta", "ctrl"], key: "x" })).toBe("ctrl+meta+X");
});

test("decodes macOS symbolic hotkeys over the defaults", () => {
  const bindings = decodeMacSymbolic({
    // Turned off: not listed.
    "60": { enabled: false, value: { parameters: [32, 49, 262144] } },
    // On, without parameters: keeps the default ⌃←.
    "79": { enabled: true },
    // Rebound to ⌥⌘S.
    "184": { enabled: true, value: { parameters: [115, 1, 0x180000] } },
  });
  const byName = (name: string) => bindings.find((b) => b.name === name);
  expect(byName("Select the previous input source")).toBeUndefined();
  expect(byName("Show Spotlight search")?.combo).toEqual({ mods: ["meta"], key: "Space" });
  expect(byName("Move left a space")?.combo).toEqual({ mods: ["ctrl"], key: "Left" });
  expect(byName("Screenshot and recording options")?.combo).toEqual({ mods: ["alt", "meta"], key: "S" });
  expect(byName("Switch to Desktop 1")).toBeUndefined();
});

test("decodes Hyprland binds", () => {
  const binds = decodeHyprBinds([
    { modmask: 64, key: "Return", dispatcher: "exec", arg: "/usr/bin/kitty --single-instance" },
    { modmask: 65, key: "1", dispatcher: "movetoworkspace", arg: "1" },
    { modmask: 64, key: "mouse:272", dispatcher: "movewindow", arg: "", mouse: true },
    { modmask: 64, key: "Q", dispatcher: "killactive", arg: "", has_description: true, description: "Close the window" },
  ]);
  expect(binds.map((b) => [b.name, comboId(b.combo)])).toEqual([
    ["Run kitty", "meta+Return"],
    ["Move window to workspace 1", "shift+meta+1"],
    ["Close the window", "meta+Q"],
  ]);
});

test("decodes GNOME and KDE shortcuts", () => {
  expect(parseGtkAccelerator("<Primary><Alt>t")).toEqual({ mods: ["ctrl", "alt"], key: "T" });
  expect(parseGtkAccelerator("<Super>Page_Up")).toEqual({ mods: ["meta"], key: "PageUp" });
  const gnome = decodeGsettings(
    [
      "org.gnome.desktop.wm.keybindings switch-to-workspace-1 ['<Super>Home']",
      "org.gnome.desktop.wm.keybindings close ['<Alt>F4']",
      "org.gnome.desktop.wm.keybindings maximize @as []",
    ].join("\n"),
    "Windows",
  );
  expect(gnome.map((b) => [b.name, comboId(b.combo)])).toEqual([
    ["Switch to workspace 1", "meta+Home"],
    ["Close", "alt+F4"],
  ]);

  expect(parseKdeShortcut("Meta+Shift+S")).toEqual({ mods: ["shift", "meta"], key: "S" });
  const kde = decodeKdeShortcuts(
    ["[kwin]", "_k_friendly_name=KWin", "Overview=Meta+W,Meta+W,Toggle Overview", "Kill Window=none,Meta+Ctrl+Esc,Kill a Window", "[org.kde.konsole.desktop]", "_launch=Ctrl+Alt+T,none,Konsole"].join("\n"),
  );
  expect(kde.map((b) => [b.name, b.group, comboId(b.combo)])).toEqual([
    ["Toggle Overview", "Windows", "meta+W"],
    ["Konsole", "App launchers", "ctrl+alt+T"],
  ]);
});

test("stores shortcuts and drops malformed entries", () => {
  const file = join(mkdtempSync(join(tmpdir(), "systo-hotkeys-")), "hotkeys.json");
  const hotkey: Hotkey = { id: "x", combo: { mods: ["alt", "meta"], key: "T" }, action: { type: "app", path: "/Applications/Safari.app", name: "Safari" }, enabled: true, createdAt: 1 };
  saveHotkeys([hotkey], file);
  expect(loadHotkeys(file)).toEqual([hotkey]);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.hotkeys.push({ id: "bad", combo: { mods: [], key: "nope" }, action: { type: "app", path: "/x" } });
  require("node:fs").writeFileSync(file, JSON.stringify(raw));
  expect(loadHotkeys(file).map((h) => h.id)).toEqual(["x"]);
});

import {
  describeCommand,
  parseAerospace,
  parseAutoHotkey,
  parseDefaultsFind,
  parseHammerspoon,
  parseKeyEquivalent,
  parsePlusCombo,
  parseRectangle,
  parseServices,
  parseSkhd,
} from "../src/lib/server/hotkeys/tools";

const ids = (bindings: { name: string; combo: KeyCombo }[]) => bindings.map((b) => [b.name, comboId(b.combo)]);

test("reads skhd, including hyper and hex keycodes", () => {
  const found = parseSkhd(
    [
      "# terminals",
      "shift + cmd - t : open -na /Applications/Alacritty.app",
      "hyper - 0x24 : yabai -m window --focus recent",
      "ctrl + alt - h : yabai -m window --focus west \\",
      "    || true",
      "resize < h : yabai -m window --resize left:-20:0",
    ].join("\n"),
  );
  expect(ids(found)).toEqual([
    ["Open Alacritty", "shift+meta+T"],
    ["Run yabai", "ctrl+alt+shift+meta+Return"],
    ["Run yabai", "ctrl+alt+H"],
  ]);
});

test("reads AeroSpace main-mode bindings only", () => {
  const found = parseAerospace(
    ["[mode.main.binding]", "alt-enter = 'exec-and-forget open -n /Applications/Alacritty.app'", "alt-shift-h = 'move left'", "[mode.service.binding]", "esc = 'reload-config'"].join("\n"),
  );
  expect(ids(found)).toEqual([
    ["Open Alacritty", "alt+Return"],
    ["Move left", "alt+shift+H"],
  ]);
});

test("reads Hammerspoon binds and resolves hyper tables", () => {
  const found = parseHammerspoon(
    `local hyper = {"cmd", "alt", "ctrl", "shift"}
hs.hotkey.bind({"cmd", "shift"}, "t", function() hs.application.launchOrFocus("Alacritty") end)
hs.hotkey.bind(hyper, "R", "Reload config", function() hs.reload() end)`,
  );
  expect(ids(found)).toEqual([
    ["Open Alacritty", "shift+meta+T"],
    ["Reload config", "ctrl+alt+shift+meta+R"],
  ]);
});

test("reads Rectangle, Services and App Shortcuts", () => {
  expect(ids(parseRectangle({ leftHalf: { keyCode: 123, modifierFlags: 0x140000 }, launchOnLogin: true }))).toEqual([["Left half", "ctrl+meta+Left"]]);
  expect(parseKeyEquivalent("@$t")).toEqual({ mods: ["shift", "meta"], key: "T" });
  expect(parseKeyEquivalent("@T")).toEqual({ mods: ["shift", "meta"], key: "T" });
  expect(parseKeyEquivalent("^~\\UF702")).toEqual({ mods: ["ctrl", "alt"], key: "Left" });
  expect(
    ids(parseServices({ NSServicesStatus: { "(null) - New Alacritty Window - runWorkflowAsService": { key_equivalent: "@$t" }, "com.x - Off - y": { key_equivalent: "@k", enabled_services_menu: false } } })),
  ).toEqual([["New Alacritty Window", "shift+meta+T"]]);
  const defaultsFind = `Found 1 keys in domain 'com.apple.Safari': {
    NSUserKeyEquivalents =     {
        "Show Sidebar" = "@~s";
    };
}
Found 1 keys in domain 'Apple Global Domain': {
    NSUserKeyEquivalents =     {
        Minimize = "@m";
    };
}`;
  const apps = parseDefaultsFind(defaultsFind, () => "Safari");
  expect(apps.map((b) => [b.name, b.owner, comboId(b.combo)])).toEqual([
    ["Show Sidebar", "Safari", "alt+meta+S"],
    ["Minimize", "All apps", "meta+M"],
  ]);
});

test("reads Windows shortcut keys and AutoHotkey", () => {
  expect(parsePlusCombo("Ctrl+Alt+T")).toEqual({ mods: ["ctrl", "alt"], key: "T" });
  const ahk = parseAutoHotkey(["^!t::Run alacritty.exe", "#Enter::Run, wt.exe ; terminal", "a::b", "; comment"].join("\n"), "C:\\x\\keys.ahk");
  expect(ids(ahk)).toEqual([
    ["Run alacritty.exe", "ctrl+alt+T"],
    ["Run wt.exe", "meta+Return"],
  ]);
  expect(describeCommand("open -na /Applications/Alacritty.app --args -e htop")).toBe("Open Alacritty");
});
