import "./styles.css";
import { ArrowDownToLineIcon, ArrowUpRightIcon, LaptopIcon, MonitorIcon, SquareTerminalIcon } from "lucide-react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { cn } from "@/lib/utils";
import BlurText from "./components/bits/BlurText";
import { DownloadButton, Footer, Nav } from "./components/chrome";
import { IslandStage } from "./components/island";
import { ProcessesReplica } from "./components/processes";
import { Proofs } from "./components/proofs";
import { RELEASES } from "./lib/changelog";
import { useDemo } from "./lib/demo";
import { RELEASES_URL, detectPlatform, formatSize, isLinuxVisitor, useDownloads, type Platform } from "./lib/releases";

function PlatformSwitch({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className="inline-flex rounded-full border bg-background p-1 shadow-sm" role="radiogroup" aria-label="Show Systo on">
      {(["macos", "windows"] as const).map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors",
            value === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p === "macos" ? <LaptopIcon className="size-3.5" /> : <MonitorIcon className="size-3.5" />}
          {p === "macos" ? "macOS" : "Windows"}
        </button>
      ))}
    </div>
  );
}

function Downloads() {
  const downloads = useDownloads();
  const latest = RELEASES.find((r) => !r.unreleased) ?? RELEASES[0];
  const rows = [downloads.macos, downloads.windows, downloads.linuxDeb, downloads.linuxRpm, downloads.linuxAppImage, downloads.linux].filter((d) => d !== undefined);
  return (
    <section id="download" className="border-t bg-sidebar">
      <div className="mx-auto max-w-[1120px] px-5 py-28 md:py-32">
        <h2 className="max-w-[18ch] text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-medium tracking-[-0.03em] text-balance">Get Systo for your computer.</h2>
        <p className="mt-4 max-w-[56ch] text-[15.5px] leading-relaxed text-muted-foreground">
          Free and open source. Choose the package for your system.
        </p>
        <div className="mt-12 overflow-hidden rounded-xl border bg-background">
          <table className="w-full text-left text-[14px]">
            <thead className="border-b text-[12px] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Platform</th>
                <th className="hidden px-5 py-3 font-medium sm:table-cell">Package</th>
                <th className="hidden px-5 py-3 font-medium md:table-cell">Version</th>
                <th className="px-5 py-3 text-right font-medium">
                  <span className="sr-only">Download</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((d) => (
                <tr key={d.url}>
                  <td className="px-5 py-5">
                    <div className="flex items-center gap-3">
                      {d.platform === "macos" ? <LaptopIcon className="size-5 shrink-0" /> : d.platform === "linux" ? <SquareTerminalIcon className="size-5 shrink-0" /> : <MonitorIcon className="size-5 shrink-0" />}
                      <div>
                        <div className="font-medium">{d.label}</div>
                        <div className="text-[12.5px] text-muted-foreground sm:hidden">{d.kind}</div>
                        <div className="text-[12.5px] text-muted-foreground">{d.requirement}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-5 py-5 text-muted-foreground sm:table-cell">
                    {d.kind}
                    {d.size ? <span className="tnum"> · {formatSize(d.size)}</span> : null}
                  </td>
                  <td className="hidden px-5 py-5 tnum md:table-cell">
                    {d.version}
                    {d.prerelease && <span className="ml-2 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">beta</span>}
                  </td>
                  <td className="px-5 py-5 text-right">
                    <a
                      href={d.url}
                      aria-label={`Download Systo for ${d.label} (${d.kind})`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <ArrowDownToLineIcon className="size-4" /> Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 grid gap-6 text-[13.5px] leading-relaxed text-muted-foreground md:grid-cols-[1fr_auto]">
          <p className="max-w-[70ch]">
            The installers aren't code-signed yet. On macOS, if Systo won't open the first time, choose{" "}
            <span className="text-foreground">Open Anyway</span> in System Settings › Privacy &amp; Security. On Windows, choose{" "}
            <span className="text-foreground">More info › Run anyway</span> when SmartScreen asks.
            {downloads.linux && (
              <>
                {" "}
                On Arch or Omarchy, extract the archive and run <span className="text-foreground">./installer</span>.
                {" "}DEB and RPM packages install through your package manager. Make the AppImage executable to run it.
                {" "}Every Linux format includes the Dynamic Island on Hyprland; other desktops get the main window and tray.
              </>
            )}
          </p>
          <div className="flex gap-5 md:justify-end">
            <a href="/changelog/" className="inline-flex items-center gap-1 text-foreground hover:underline">
              What's new in {latest.version} <ArrowUpRightIcon className="size-3.5" />
            </a>
            <a href={RELEASES_URL} className="inline-flex items-center gap-1 text-foreground hover:underline">
              Release notes &amp; checksums <ArrowUpRightIcon className="size-3.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Home() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const demo = useDemo(platform);
  const downloads = useDownloads();
  const primary = isLinuxVisitor() ? downloads.linuxAppImage ?? downloads.linux : downloads[platform];
  const other: Platform = platform === "macos" ? "windows" : "macos";

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Nav current="home" />
      <main id="main">
        <section className="px-3 pt-6 sm:px-5 sm:pt-8">
          <IslandStage platform={platform} demo={demo} />
          <div className="relative mx-auto -mt-5 flex max-w-[1120px] justify-center">
            <PlatformSwitch value={platform} onChange={setPlatform} />
          </div>
          <div className="mx-auto flex max-w-[1120px] flex-col items-center px-2 pt-12 pb-24 text-center sm:pt-14 md:pb-28">
            <h1 className="text-[clamp(2.5rem,5.4vw,4rem)] leading-[1.02] font-medium tracking-[-0.04em]">
              <BlurText text="See what your computer is doing." animateBy="words" delay={60} className="justify-center" />
              <BlurText text="And what's safe to stop." animateBy="words" delay={60} className="justify-center text-muted-foreground" />
            </h1>
            <p className="mt-6 max-w-[58ch] text-[clamp(1rem,1.4vw,1.15rem)] leading-relaxed text-muted-foreground text-balance">
              Systo is a calm process manager for macOS, Windows and Linux. Clear names, honest numbers, and a Dynamic Island with your busiest apps one hover away.
            </p>
            <div className="mt-9 flex flex-col items-center gap-4">
              <DownloadButton download={primary} />
              <p className="text-[13px] text-muted-foreground tnum">
                Version {primary.version} · {primary.requirement} ·{" "}
                <a href={downloads[other].url} className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
                  Get it for {downloads[other].label}
                </a>
              </p>
            </div>
          </div>
        </section>

        <section className="border-t bg-sidebar px-3 py-24 sm:px-5 md:py-32">
          <div className="mx-auto max-w-[1120px]">
            <div className="mb-12 grid gap-4 md:grid-cols-2 md:items-end">
              <h2 className="max-w-[16ch] text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-medium tracking-[-0.03em] text-balance">
                The table you know, finally readable.
              </h2>
              <p className="max-w-[48ch] text-[15.5px] leading-relaxed text-muted-foreground md:justify-self-end">
                Processes are grouped by app the way {platform === "macos" ? "Activity Monitor" : "Task Manager"} never quite manages, and busy cells darken so the culprit finds you. Sort it, search it, open a group. It's live.
              </p>
            </div>
            <ProcessesReplica platform={platform} demo={demo} />
          </div>
        </section>

        <Proofs platform={platform} />
        <Downloads />
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
