# Systo

A clearer view of your computer. Systo is a system monitor for macOS, Windows and Linux inspired by the simplicity of Windows Task Manager, with a monochrome interface and a Dynamic Island overlay.

## Features

- **Processes:** see apps and their helpers in groups, inspect resource usage, learn what a process does, and end tasks.
- **Background monitoring:** closing the window keeps Systo in the menu bar or notification area. Use Open Systo to return or Quit Systo to exit. Installed apps enable background startup at login by default; turn it off in Settings.
- **Performance:** live CPU, memory, disk, and network charts.
- **History:** find the biggest resource users over 1 hour, 3 hours, 1 day, 7 days, 30 days, or 90 days. History builds as Systo runs and is stored locally in SQLite.
- **Startup:** manage login items, launch agents, and system daemons with reversible switches. System daemons require administrator authorization; registered helper discovery is an explicit action.
- **Dynamic Island:** glance at CPU, RAM, and storage usage, plus separate download and upload speeds. Expand it to see top resource consumers.
- **Disk analyzer:** explore folders with sunburst and treemap views, find large files and cleanup candidates, reveal items in Finder, or move selected items to Trash with confirmation.
- **Installer:** an offline macOS installer with the Core logo and a drag-or-click installation flow.

## Linux

Systo reads everything from `/proc` and `/sys`, so it needs no helper and no root. It is built and tested on Omarchy (Arch, Hyprland) and written against freedesktop standards rather than one distribution.

- **Processes:** apps are the processes that own a window, named and given icons from their `.desktop` entries. What an app starts is grouped under it, and kernel threads collapse into one entry. Window ownership comes from Hyprland; on other desktops apps are recognized by their launcher entry.
- **Startup:** XDG autostart entries, systemd user services and systemd system services. Turning an autostart entry off writes the standard `Hidden=true` override in `~/.config/autostart`; system services ask for an administrator password through polkit.
- **Dynamic Island:** a floating pill under the bar, on Hyprland. Other compositors get the main window and the tray.
- **Disk analyzer:** stays on the scanned filesystem, follows btrfs subvolumes of the same disk, and moves items to the freedesktop Trash.
- **Network per app** counts TCP only; UDP traffic such as QUIC shows in the system total. GPU load is reported where the driver publishes it (amdgpu).

Runtime packages: glibc 2.38 or newer (Ubuntu 24.04, Fedora 39, current Arch), WebKitGTK 4.1, GTK 3 and `libayatana-appindicator` for the tray. `iproute2` (`ss`), `gio` and a polkit agent enable per-app network, Trash and administrator actions. Choosing a folder in the Disk analyzer needs one of `zenity`, `kdialog` or Python's GTK bindings (`python-gobject` / `python3-gi`).

## Development

Systo uses Farm.js, React, TypeScript, shadcn/ui, and Electrobun. Native integrations use each platform's own APIs and system tools: libproc and AppKit on macOS, Win32 on Windows, `/proc`, systemd and the Hyprland socket on Linux.

Requirements: Node.js 22.13 or newer, Bun, and pnpm, on macOS (with Xcode Command Line Tools), Windows or Linux. The installer builds for the host architecture.

```sh
pnpm install
pnpm dev
```

To run only the web development interface:

```sh
pnpm dev:web
```

## Build

```sh
pnpm type-check
pnpm build:installer
```

The installer is written to `dist/Systo Installer.app` and the disk image to `dist/Systo-Installer-arm64.dmg` (`x64` on an Intel host). See [installer documentation](installer/README.md) for installation behavior and native tests.

On Linux, `pnpm build` writes `.farm/output/desktop/dist/update/linux-x64-Systo-Setup.tar.gz`. Extract it and run `./installer`: Systo is installed under `~/.local/share/dev.systo.monitor` and added to the app launcher. This archive works on Arch / Omarchy and keeps in-app updates.

Linux releases also include `Systo-Linux-x64.deb` (Ubuntu 24.04+ / compatible Debian systems with glibc 2.38+), `Systo-Linux-x64.rpm` (Fedora with glibc 2.38+) and `Systo-Linux-x64.AppImage`. Install packages with `sudo apt install ./Systo-Linux-x64.deb` or `sudo dnf install ./Systo-Linux-x64.rpm`. For AppImage, run `chmod +x Systo-Linux-x64.AppImage` and `./Systo-Linux-x64.AppImage`. AppImage still requires the GTK / WebKitGTK runtime packages listed above; if FUSE isn't available, use `./Systo-Linux-x64.AppImage --appimage-extract-and-run`. Update DEB/RPM installations by installing a newer package; replace an AppImage with a newer download. All formats include Hyprland's Dynamic Island and work as a normal main window and tray on other desktops.

To package on an x86_64 Linux host after `pnpm build`, install the pinned tools with `bash scripts/setup-linux-packaging.sh /tmp/systo-tools`, add that directory to `PATH`, then run `pnpm build:linux-packages`. The script reuses Electrobun's built update payload and writes the three extra packages into `release/`.

Builds currently use ad-hoc signing for local use. Developer ID signing and Apple notarization are not configured.

## Checks

```sh
bun test tests
bun scripts/linux-smoke.ts   # on Linux: the data layer against the real machine
xcrun swiftc installer/InstallService.swift installer/InstallServiceTests.swift -o /tmp/systo-install-tests
/tmp/systo-install-tests
```
