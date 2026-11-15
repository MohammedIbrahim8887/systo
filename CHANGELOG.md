# Changelog

All notable changes to Systo. The release workflow publishes each version's section as its
GitHub release notes, and the website's changelog page renders this file.

## [0.1.1] - 2026-11-15

### Added
- **Windows in the stable download.** The Windows installer ships with this release: a floating Dynamic Island, grouped processes, startup toggles and the disk analyzer.
- **Updates inside the app.** Systo checks for new versions on launch and every few hours, downloads them in the background, and installs with one click: **Restart to update** in Settings, the sidebar or the menu bar / tray.
- **Open at login.** A Settings toggle starts Systo when you log in to your Mac or sign in to Windows.
- A website with downloads and this changelog: [systo.mohammedibrahim.dev](https://systo.mohammedibrahim.dev).

### Improved
- **Much lighter.** About 120 MB with only the Dynamic Island running, and around a third less memory with the main window open. Sampling CPU is down by two thirds when the window is closed.
- The process table only draws the rows you can see, so scrolling stays smooth with hundreds of processes.
- The main window stops refreshing while it's hidden or minimized.
- The Disk analyzer releases its scan from memory when you're not using it, and scans with fewer workers.
- The Dynamic Island's panel only exists while it's open.

### Fixed
- Windows: usage History now records in the background, not only while the window is open.

## [0.2.0-beta.1] - 2026-11-14

### Added
- **Systo for Windows** (beta), for Windows 10 and 11 on x64.
- A floating Dynamic Island at the top of the main display that expands on hover and hides during fullscreen apps.
- Processes grouped by program like Task Manager, with real app icons and names.
- Startup apps you can turn on and off the way Task Manager does.
- Disk analyzer with Recycle Bin support.

## [0.1.0] - 2026-11-14

### Added
- First release for macOS on Apple Silicon.
- **Processes** grouped by app, with heat-shaded CPU, memory, disk and network columns, plain-English explanations and safe End task.
- **Performance** charts for CPU, memory, disk, network and GPU.
- **History** of the top apps over the last hour up to 90 days.
- **Startup** items, with toggles that never delete anything.
- **Disk** analyzer with a sunburst, treemap and cleanup suggestions.
- **Dynamic Island** over the notch with CPU, RAM, storage and network rings and the top apps.
