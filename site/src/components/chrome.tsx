import { ArrowDownToLineIcon } from "lucide-react";
import { Logo } from "@/components/systo/logo";
import { cn } from "@/lib/utils";
import { REPO_URL, RELEASES_URL, formatSize, type Download } from "../lib/releases";
import ClickSpark from "./bits/ClickSpark";
import Magnet from "./bits/Magnet";

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Nav({ current }: { current: "home" | "changelog" }) {
  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
      <nav className="mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-5" aria-label="Main">
        <a href="/" className="flex items-center gap-2 rounded-md text-[15px] font-medium tracking-tight">
          <Logo className="size-6" />
          Systo
        </a>
        <span className="flex-1" />
        <a href="/#features" className="hidden text-[13.5px] text-muted-foreground transition-colors hover:text-foreground sm:inline">
          Features
        </a>
        <a
          href="/changelog/"
          aria-current={current === "changelog" ? "page" : undefined}
          className={cn("text-[13.5px] transition-colors hover:text-foreground", current === "changelog" ? "text-foreground" : "text-muted-foreground")}
        >
          Changelog
        </a>
        <a href={REPO_URL} className="hidden items-center gap-1.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground sm:flex">
          <GithubMark className="size-4" /> GitHub
        </a>
        <a href="/#download" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
          <ArrowDownToLineIcon className="size-3.5" /> Download
        </a>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-5 py-10 text-[13px] text-muted-foreground sm:flex-row sm:items-center">
        <span className="flex items-center gap-2 text-foreground">
          <Logo className="size-5" />
          <span className="font-medium">Systo</span>
          <span className="text-muted-foreground">
            · Made by{" "}
            <a href="https://mohammedibrahim.dev" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              Mohammed Ibrahim
            </a>
          </span>
        </span>
        <span className="flex-1" />
        <span className="flex gap-6">
          <a className="hover:text-foreground" href="/changelog/">
            Changelog
          </a>
          <a className="hover:text-foreground" href={RELEASES_URL}>
            Releases
          </a>
          <a className="hover:text-foreground" href={REPO_URL}>
            Source
          </a>
        </span>
      </div>
    </footer>
  );
}

/** The primary action: pulls gently toward the pointer and throws a spark when pressed. */
export function DownloadButton({ download, size = "lg" }: { download: Download; size?: "lg" | "md" }) {
  return (
    <Magnet padding={60} magnetStrength={6} maxOffset={10} wrapperClassName="inline-block" innerClassName="inline-block">
      <ClickSpark sparkColor="currentColor" sparkCount={10} sparkRadius={26} sparkSize={9} duration={420} className="inline-block text-foreground">
        <a
          href={download.url}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground shadow-[0_10px_30px_-12px_rgb(0_0_0/0.45)] transition-[opacity,transform] hover:opacity-92 active:scale-[0.98]",
            size === "lg" ? "h-12 px-5 text-[15px]" : "h-9 px-3.5 text-[13px]",
          )}
        >
          <ArrowDownToLineIcon className={size === "lg" ? "size-[18px]" : "size-4"} />
          Download for {download.label}
          {size === "lg" && download.size ? <span className="font-normal opacity-60 tnum">· {formatSize(download.size)}</span> : null}
        </a>
      </ClickSpark>
    </Magnet>
  );
}
