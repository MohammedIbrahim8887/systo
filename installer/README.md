# Systo installer

Build the app and a self-contained macOS installer with `pnpm build:installer`.

Outputs:
- `dist/Systo Installer.app`
- `dist/Systo-Installer-arm64.dmg` (or `x64` on an Intel build host)

The build targets the host architecture. It requires macOS, Xcode command-line tools, and the project dependencies. The native AppKit wrapper loads an offline HTML view through WKWebView and bundles the production Systo app. No server or network connection is required by the installer.

The Quiet Install interface supports dragging the Core icon onto the Applications folder inside the installer, or clicking either icon. Both invoke the same native installation service. The default destination is `/Applications`; Change folder lets the user choose another writable directory. Existing installations require confirmation. The installed copy has the download quarantine flag removed: Systo unpacks itself in place on first launch, and macOS runs a quarantined app from a read-only location where that fails. Copying uses a temporary directory on the destination volume, retaining the old app until replacement succeeds. If Systo is running, the installer offers to quit it (force-quitting a leftover instance that ignores the request). Settings are outside the app bundle and are retained. Open Systo launches the installed copy.

The build uses an ad-hoc signature for local use. Developer ID signing and Apple notarization are not configured; those are required before distributing a trusted download publicly.

Validation:

```sh
pnpm type-check
xcrun swiftc installer/InstallService.swift installer/InstallServiceTests.swift -o /tmp/systo-install-tests
/tmp/systo-install-tests
```

The tests use disposable folders and check fresh installation, quarantine removal, replacement, staging cleanup, preservation after invalid payloads, and rejection of a symbolic-link target. `index.html` can also be previewed with icon.png, applications.png and Geist.woff2 beside it; the built app’s Resources folder contains all four. Packaging exports applications.png from the host macOS Applications folder icon. Installation actions are intentionally unavailable in an ordinary browser.
