# Systo installer

Build the app and a self-contained macOS installer with `pnpm build:installer`.

Outputs:
- `dist/Systo Installer.app`
- `dist/Systo-Installer-arm64.dmg` (or `x64` on an Intel build host)

The build targets the host architecture. It requires macOS, Xcode command-line tools, and the project dependencies. The native AppKit wrapper loads an offline HTML view through WKWebView and bundles the production Systo app. No server or network connection is required by the installer.

The default destination is `/Applications`; Change lets the user choose another writable directory. Existing installations require confirmation. Copying uses a temporary directory on the destination volume, retaining the old app until replacement succeeds. Running Systo must be quit before installation. Settings are outside the app bundle and are retained. Open Systo launches the installed copy.

The build uses an ad-hoc signature for local use. Developer ID signing and Apple notarization are not configured; those are required before distributing a trusted download publicly.

Validation:

```sh
pnpm type-check
xcrun swiftc installer/InstallService.swift installer/InstallServiceTests.swift -o /tmp/systo-install-tests
/tmp/systo-install-tests
```

The tests use disposable folders and check fresh installation, replacement, staging cleanup, preservation after invalid payloads, and rejection of a symbolic-link target. `index.html` can also be previewed with icon.png and Geist.woff2 beside it; the built app’s Resources folder contains all three. Installation actions are intentionally unavailable in an ordinary browser.
