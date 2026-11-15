import { useEffect, useState } from "react";

export const REPO = "MohammedIbrahim8887/systo";
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;

export type Platform = "macos" | "windows";
/** Linux has a download but no page demo, so it isn't a `Platform` the site can switch to. */
export type DownloadPlatform = Platform | "linux";

export interface Download {
  platform: DownloadPlatform;
  label: string;
  requirement: string;
  kind: string;
  url: string;
  version: string;
  size?: number;
  /** The GitHub release page for notes and checksums. */
  releaseUrl: string;
  prerelease: boolean;
}

const ASSETS: Record<DownloadPlatform, { pattern: RegExp; file: string; label: string; requirement: string; kind: string }> = {
  macos: { pattern: /Installer-arm64\.dmg$/, file: "Systo-Installer-arm64.dmg", label: "macOS", requirement: "Apple silicon · macOS 13 or later", kind: "DMG" },
  windows: { pattern: /Setup-x64\.exe$/, file: "Systo-Setup-x64.exe", label: "Windows", requirement: "64-bit · Windows 10 (1809) or 11", kind: "Installer" },
  linux: { pattern: /Linux-x64\.tar\.gz$/, file: "Systo-Linux-x64.tar.gz", label: "Linux", requirement: "64-bit · WebKitGTK 4.1 · Dynamic Island on Hyprland", kind: "Installer archive" },
};

/** Every platform has a row; Linux only once a release carries its installer. */
export type Downloads = Record<Platform, Download> & { linux?: Download };

/** Used before GitHub answers, and if it can't: the latest stable release's files. */
function fallback(platform: DownloadPlatform): Download {
  const a = ASSETS[platform];
  return {
    platform,
    label: a.label,
    requirement: a.requirement,
    kind: a.kind,
    url: `${RELEASES_URL}/latest/download/${a.file}`,
    version: __APP_VERSION__,
    releaseUrl: `${RELEASES_URL}/latest`,
    prerelease: false,
  };
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

let cache: Promise<Downloads> | null = null;

/** Newest release that actually carries each platform's installer, pre-releases included. */
function load(): Promise<Downloads> {
  return (cache ??= fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? (r.json() as Promise<GitHubRelease[]>) : Promise.reject(new Error(String(r.status)))))
    .then((releases) => {
      const find = (platform: DownloadPlatform): Download | undefined => {
        for (const release of releases) {
          if (release.draft) continue;
          const asset = release.assets.find((x) => ASSETS[platform].pattern.test(x.name));
          if (asset) {
            return {
              ...fallback(platform),
              url: asset.browser_download_url,
              version: release.tag_name.replace(/^v/, ""),
              size: asset.size,
              releaseUrl: release.html_url,
              prerelease: release.prerelease,
            };
          }
        }
        return undefined;
      };
      const pick = (platform: Platform) => find(platform) ?? fallback(platform);
      return { macos: pick("macos"), windows: pick("windows"), linux: find("linux") };
    })
    .catch(() => ({ macos: fallback("macos"), windows: fallback("windows") })));
}

export function useDownloads(): Downloads {
  const [downloads, setDownloads] = useState<Downloads>(() => ({ macos: fallback("macos"), windows: fallback("windows") }));
  useEffect(() => {
    let live = true;
    void load().then((d) => live && setDownloads(d));
    return () => {
      live = false;
    };
  }, []);
  return downloads;
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "macos";
  return /Windows/i.test(navigator.userAgent) ? "windows" : "macos";
}

export function formatSize(bytes?: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(0)} MB` : "";
}
