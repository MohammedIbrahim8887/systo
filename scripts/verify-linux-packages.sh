#!/usr/bin/env bash
set -euo pipefail
packages="$(cd "${1:-release}" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
version="$(node -p 'require("./package.json").version')"
test "$(dpkg-deb -f "$packages/Systo-Linux-x64.deb" Version)" = "$version-1"
test "$(dpkg-deb -f "$packages/Systo-Linux-x64.deb" Architecture)" = amd64
test "$(rpm -qp --queryformat '%{VERSION}' "$packages/Systo-Linux-x64.rpm")" = "$version"
test "$(rpm -qp --queryformat '%{ARCH}' "$packages/Systo-Linux-x64.rpm")" = x86_64
dpkg-deb -x "$packages/Systo-Linux-x64.deb" "$work/deb"
mkdir "$work/rpm"
(cd "$work/rpm" && rpm2cpio "$packages/Systo-Linux-x64.rpm" | cpio -idm --quiet)
(cd "$work" && "$packages/Systo-Linux-x64.AppImage" --appimage-extract > /dev/null)
for format in deb rpm; do
  test "$(readlink "$work/$format/usr/bin/systo")" = /opt/systo/bin/launcher
  desktop-file-validate "$work/$format/usr/share/applications/dev.systo.monitor.desktop"
done
desktop-file-validate "$work/squashfs-root/dev.systo.monitor.desktop"
node --input-type=module - "$work" "$version" <<'JS'
import { readFileSync, accessSync, constants } from 'node:fs';
import assert from 'node:assert/strict';
const [work, version] = process.argv.slice(2);
for (const [dir, format] of [['deb', 'deb'], ['rpm', 'rpm'], ['squashfs-root', 'appimage']]) {
  const root = `${work}/${dir}/opt/systo`;
  accessSync(`${root}/bin/launcher`, constants.X_OK);
  accessSync(`${root}/bin/bun`, constants.X_OK);
  const info = JSON.parse(readFileSync(`${root}/Resources/version.json`, 'utf8'));
  assert.equal(info.version, version);
  assert.equal(info.baseUrl, '');
  assert.equal(readFileSync(`${root}/Resources/package-format`, 'utf8'), format);
}
console.log('DEB, RPM and AppImage metadata, launchers and update policy verified.');
JS
