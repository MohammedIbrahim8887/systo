# Systo

A clearer view of your Mac. Systo is a macOS system monitor inspired by the simplicity of Windows Task Manager, with a monochrome interface and a Dynamic Island overlay.

## Features

- **Processes:** see apps and their helpers in groups, inspect resource usage, learn what a process does, and end tasks.
- **Performance:** live CPU, memory, disk, and network charts.
- **History:** find the biggest resource users over 1 hour, 3 hours, 1 day, 7 days, 30 days, or 90 days. History builds as Systo runs and is stored locally in SQLite.
- **Startup:** manage login items, launch agents, and system daemons with reversible switches. System daemons require administrator authorization; registered helper discovery is an explicit action.
- **Dynamic Island:** glance at CPU, RAM, and storage usage, plus separate download and upload speeds. Expand it to see top resource consumers.
- **Disk analyzer:** explore folders with sunburst and treemap views, find large files and cleanup candidates, reveal items in Finder, or move selected items to Trash with confirmation.
- **Installer:** an offline macOS installer with the Core logo and a drag-or-click installation flow.

## Development

Systo uses Farm.js, React, TypeScript, shadcn/ui, and Electrobun. Native integrations use macOS APIs and system tools.

Requirements: macOS, Xcode Command Line Tools, Node.js 22.13 or newer, Bun, and pnpm. The installer builds for the host architecture.

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

Builds currently use ad-hoc signing for local use. Developer ID signing and Apple notarization are not configured.

## Checks

```sh
bun test tests/startup.test.ts
xcrun swiftc installer/InstallService.swift installer/InstallServiceTests.swift -o /tmp/systo-install-tests
/tmp/systo-install-tests
```
