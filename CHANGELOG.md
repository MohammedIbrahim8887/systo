# Changelog

All notable changes to Systo. The release workflow publishes each version's section as its
GitHub release notes, and the website's changelog page renders this file.

## [0.1.10] - 2026-11-25

### Added
- **Themes.** Settings › Appearance offers 27 color themes beside Systo's own monochrome, from Absolutely and Ayu to Vercel and VS Code Plus. Dark and light each keep their own theme, and System follows your computer. Point at a theme in the list to see it across the app before choosing it.
- **Make it yours.** Change the accent, background and foreground with a color picker or a hex value, set the interface and code fonts, and raise the contrast. Each color resets on its own, and Systo offers a fix when text gets hard to read.
- **Translucent windows on macOS,** for the whole window or the sidebar only, with opacity and blur.
- **Share themes.** Copy a theme as text and import one someone sent you.
- Charts, meters, the heatmap, the macOS title bar and the Dynamic Island's rings follow the theme.

### Improved
- Settings has General and Appearance sections.
- Light and dark mode, and your themes, now stay the same after Systo restarts.

### Fixed
- Update speed, CPU percentages, heatmap, colored icons, the island's view and dismissed AI logins no longer reset every time Systo starts.
- The Empty Trash button's text was unreadable in the dark theme.

### Notes
- Settings were kept somewhere that emptied on every launch, so earlier choices can't be carried over. Set them once more after updating.
- Translucent windows work on macOS only. Five themes (Lobster, Matrix, Oscurange, Sentry and Temple) are dark only.

## [0.1.9] - 2026-11-23

### Added
- **Global shortcuts.** A new Shortcuts view (⌘7 on macOS, Ctrl+7 elsewhere) binds keys that work in every app, even with Systo's window closed. A shortcut can open an app, a website, a file or folder, run a command, show Systo, or turn the Dynamic Island on and off.
- **Live key recorder.** Each modifier lights up as you hold it and the key lands in place, drawn as keycaps in your platform's own symbols. Esc cancels and ⌫ clears. Your existing shortcuts pause while you record, so pressing one doesn't launch it.
- **Plain-language checks as you record.** Systo says whether the keys are free, shared with something else, or blocked, and refuses combinations that would take over normal typing, like a bare letter or ⌥ plus a letter on a Mac.
- **Everything in one place.** Search your shortcuts by name or keys, try one without pressing it, edit or re-record from its row, turn it on or off, and undo a delete. Rows show when each was last used and how many times, and flash when you press one.
- **Shortcuts already in use, in tabs.** Yours, the system's, other apps', and everyday keys like copy and paste each get a tab with a count. The system tab reads your own Keyboard Shortcuts settings on macOS, and Hyprland, GNOME or KDE bindings on Linux.
- **Look up by pressing keys.** Press a combination in the search box to see everything that uses it across every tab, or that it's free, with a one-click "Use for a shortcut".
- **Keys held by other apps.** Systo tries every combination to find keys that running apps keep for themselves, such as a hotkey helper's ⇧⌘T, and lets you name them. It also reads skhd, AeroSpace, Hammerspoon, Rectangle, Services and App Shortcuts on macOS, and shortcut keys on Start menu items and AutoHotkey scripts on Windows.

### Improved
- The app picker lists installed apps with their icons, supports search and arrow keys, and also takes any app you choose from a file picker.
- Start menu shortcuts on Windows now show their icons.

### Notes
- macOS asks you to turn Systo on in System Settings › Privacy & Security › Accessibility before shortcuts work in other apps. Systo shows a banner with a button, and starts listening the moment you allow it.
- Detecting held keys works on macOS and Windows. Apps that listen without reserving their keys, such as Raycast, can't be seen this way.
- If another app already holds your keys, Systo marks the shortcut "Blocked", since it can't hear them while that app runs.

## [0.1.8] - 2026-11-21

### Added
- **Multi-select cleanup in Disk.** Tick items in Contents, Largest files and the Cleanup tab, then move them all to the Trash (Recycle Bin on Windows) in one step. A confirmation lists every item and its size first.
- **One-click cleanup.** "Select all safe" and a per-card "Clean up…" button on each safe-to-remove suggestion. Single-folder suggestions like app caches clear what's inside and keep the folder.
- **Empty Trash** from the Trash suggestion on macOS and Linux.

### Improved
- Bulk moves use one Finder, gio or PowerShell call per batch instead of one per item, and report partial failures. Protected system and home folders are still refused.
- The dependency and build folders list shows up to 120 folders instead of 40.

## [0.1.7] - 2026-11-17

### Added
- **AI usage dashboard.** Track multiple AI accounts, subscription limits, reset times, local tokens, and reported or estimated USD. Connect detected local logins or a separate account folder.
- **AI usage in the Dynamic Island.** Switch between system monitoring and AI usage; see quota windows, resets, 30-day token totals, and API-value estimates. The collapsed island shows the limit closest to exhaustion.
- **Claude account discovery.** Detect separate Claude installations, including Sona and Synara account homes, with isolated macOS Keychain credential reads.

### Improved
- **Faster initial loading.** Account placeholders appear immediately while provider checks and session scans update progressively. Shared work avoids duplicate checks across windows.
- **Loading skeletons.** Loading placeholders keep the process table, performance view, island, and AI usage readable while data arrives, with reduced-motion support.
- **Reliable cost estimates.** Bundled public rates work offline and refresh in the background. Large session files are streamed; final Claude usage and distinct Codex responses are counted correctly. Shared history is counted once and labelled; partial estimates are marked.

- **Clearer cost reporting.** Dollar totals labelled “API value” use public API list prices. Subscription charges are separate, and available limits and history depend on the provider and login source.

### Fixed
- **macOS full-screen overlay.** The Dynamic Island now uses a native non-activating panel, keeping it visible over other applications and their full-screen Spaces. A single island stays on the primary display, without duplicate overlays on external monitors.
- Account editing retains custom token-history folders, bulk connections report actual successes, and long account forms keep their action buttons visible.


## [0.1.6] - 2026-11-17

### Fixed
- **Disk sizes on macOS.** Keep native scanner buffers alive between worker requests. The bundled runtime could free the request buffer before a scan, causing readable folders to appear empty with 0 bytes and a misleading Full Disk Access warning.
- Scanner exceptions now show their actual error instead of being reported as successful empty scans.

## [0.1.5] - 2026-11-16

### Improved
- Systo keeps monitoring in the background after the last window closes. Open it again from the menu bar or tray, or choose Quit Systo to exit.
- Installed apps enable background startup at login by default on macOS, Windows and Linux. Existing opt-outs are preserved, and automatic startup can be disabled in Settings.

### Fixed
- The disk analyzer no longer stays on Scanning when a scan completes or fails before the first progress update.
- Scan failures display their error even when an older scan result is available.

## [0.1.4] - 2026-11-16

### Added
- Linux downloads in DEB, RPM and AppImage formats, alongside the installer archive for Arch and Omarchy. Every format includes the Dynamic Island on Hyprland.
- The download page lists available Linux packages and offers Linux visitors a Linux download.

### Fixed
- AppImage's Open at login setting now starts the downloaded image rather than a temporary mount.
- Package installations explain how to update without attempting to overwrite managed or read-only files.

## [0.1.3] - 2026-11-16

### Added
- **Linux.** Systo runs on Linux, built and tested on Omarchy: grouped processes with app names and icons, performance charts, history, the disk analyzer, and startup toggles for autostart entries and systemd services.
- **Dynamic Island on Hyprland.** A floating pill under the bar that opens on hover and hides while something is fullscreen.
- A Linux installer in every release, with in-app updates.

### Fixed
- **Restart to update** no longer closes Systo without installing anything. The app's server asked for time to shut down when the updater requested the restart, which the updater took as a refusal; Systo now stops the server first.

## [0.1.2] - 2026-11-16

### Fixed
- **macOS installation.** Fixed the first-launch “The application could not be installed” error caused by macOS running the downloaded app from a read-only location. The installer now removes the quarantine flag from its installed copy so Systo can finish unpacking.
- If installation failed with 0.1.1, download and run the 0.1.2 installer below. Existing settings are retained.

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
