import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build Linux x64 packages on an x86_64 Linux host.');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const archive = resolve(process.argv[2] || '.farm/output/desktop/dist/update/stable-linux-x64-Systo.tar.zst');
const output = resolve(process.argv[3] || 'release');
const work = mkdtempSync(join(tmpdir(), 'systo-packages-'));
const run = (tool, args, env = {}) => execFileSync(tool, args, { stdio: 'inherit', env: { ...process.env, ...env } });
mkdirSync(output, { recursive: true });
try {
  run('tar', ['--zstd', '-xf', archive, '-C', work]);
  const app = join(work, 'Systo');
  const manifest = join(app, 'Resources', 'version.json');
  const info = JSON.parse(readFileSync(manifest, 'utf8'));
  if (info.version !== version) throw new Error(`Payload ${info.version} does not match package.json ${version}.`);
  // Managed installs and mounted AppImages cannot be replaced by Electrobun's archive updater.
  writeFileSync(manifest, JSON.stringify({ ...info, baseUrl: '' }));
  rmSync(join(app, 'Systo.desktop'), { force: true });
  const desktop = resolve('installer/linux/systo.desktop');
  const icon = join(app, 'Resources', 'appIcon.png');
  for (const format of ['deb', 'rpm']) {
    writeFileSync(join(app, 'Resources', 'package-format'), format);
    const config = {
      name: 'systo', arch: 'amd64', platform: 'linux', version, release: '1',
      maintainer: 'Mohammed Ibrahim <MohammedIbrahim8887@users.noreply.github.com>',
      homepage: 'https://systo.mohammedibrahim.dev', section: 'utils',
      description: 'A process manager with performance charts and a Dynamic Island on Hyprland.',
      contents: [
        { src: `${app}/`, dst: '/opt/systo', type: 'tree' },
        { src: '/opt/systo/bin/launcher', dst: '/usr/bin/systo', type: 'symlink' },
        { src: desktop, dst: '/usr/share/applications/dev.systo.monitor.desktop' },
        { src: icon, dst: '/usr/share/icons/hicolor/256x256/apps/dev.systo.monitor.png' },
      ],
      depends: format === 'deb'
        ? ['libc6 (>= 2.38)', 'libstdc++6', 'libgtk-3-0t64', 'libwebkit2gtk-4.1-0', 'libayatana-appindicator3-1', 'libx11-6', 'libxext6']
        : ['glibc >= 2.38', 'libstdc++', 'gtk3', 'webkit2gtk4.1', 'libayatana-appindicator-gtk3', 'libX11', 'libXext'],
      recommends: format === 'deb' ? ['iproute2', 'libglib2.0-bin', 'pkexec', 'zenity'] : ['iproute', 'glib2', 'polkit', 'zenity'],
    };
    const configFile = join(work, `nfpm-${format}.json`);
    writeFileSync(configFile, JSON.stringify(config));
    run('nfpm', ['package', '--config', configFile, '--packager', format, '--target', join(output, `Systo-Linux-x64.${format}`)]);
  }
  const appDir = join(work, 'Systo.AppDir');
  mkdirSync(join(appDir, 'opt'), { recursive: true });
  writeFileSync(join(app, 'Resources', 'package-format'), 'appimage');
  cpSync(app, join(appDir, 'opt', 'systo'), { recursive: true });
  cpSync(desktop, join(appDir, 'dev.systo.monitor.desktop'));
  cpSync(icon, join(appDir, 'dev.systo.monitor.png'));
  cpSync(icon, join(appDir, '.DirIcon'));
  cpSync('installer/linux/AppRun', join(appDir, 'AppRun'));
  chmodSync(join(appDir, 'AppRun'), 0o755);
  run('appimagetool', [appDir, join(output, 'Systo-Linux-x64.AppImage')], { ARCH: 'x86_64', VERSION: version, APPIMAGE_EXTRACT_AND_RUN: '1' });
} finally {
  rmSync(work, { recursive: true, force: true });
}
