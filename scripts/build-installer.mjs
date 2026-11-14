import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { arch } from 'node:os';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const payload = resolve('.farm/output/desktop/dist/Systo.app');
if (!existsSync(payload)) throw new Error('Build Systo first with pnpm build.');
const output = resolve('dist');
const app = join(output, 'Systo Installer.app');
const contents = join(app, 'Contents');
const resources = join(contents, 'Resources');
// Only remove this script’s generated bundle, never installed apps.
rmSync(app, { recursive: true, force: true });
mkdirSync(join(contents, 'MacOS'), { recursive: true });
mkdirSync(resources, { recursive: true });
run('xcrun', ['swiftc', '-O', '-target', `${arch() === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`, 'installer/InstallService.swift', 'installer/main.swift', '-o', join(contents, 'MacOS', 'SystoInstaller'), '-framework', 'AppKit', '-framework', 'WebKit']);
cpSync('installer/index.html', join(resources, 'index.html'));
cpSync('assets/icon.png', join(resources, 'icon.png'));
run('sips', ['-s', 'format', 'png', '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns', '--out', join(resources, 'applications.png')]);
cpSync('node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', join(resources, 'Geist.woff2'));
run('/usr/bin/ditto', [payload, join(resources, 'Systo.app')]);
// Farm’s outer launcher is linker-signed; seal the complete copied bundle.
run('codesign', ['--force', '--deep', '--sign', '-', join(resources, 'Systo.app')]);
run('codesign', ['--verify', '--deep', '--strict', join(resources, 'Systo.app')]);
const iconset = join(output, 'Installer.iconset');
mkdirSync(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    run('sips', ['-z', String(size * scale), String(size * scale), 'assets/icon.png', '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
}
run('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'Installer.icns')]);
rmSync(iconset, { recursive: true });
writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>SystoInstaller</string>
<key>CFBundleIdentifier</key><string>dev.systo.installer</string>
<key>CFBundleName</key><string>Systo Installer</string>
<key>CFBundleDisplayName</key><string>Systo Installer</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleIconFile</key><string>Installer</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
run('codesign', ['--force', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', app]);
const dmg = join(output, `Systo-Installer-${arch()}.dmg`);
run('hdiutil', ['create', '-volname', 'Install Systo', '-srcfolder', app, '-format', 'UDZO', '-ov', dmg]);
console.log(`Installer app: ${app}\nDisk image: ${dmg}`);
