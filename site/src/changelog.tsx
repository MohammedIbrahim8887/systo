import "./styles.css";
import { ArrowUpRightIcon } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Footer, Nav } from "./components/chrome";
import { RELEASES, formatDate, type Inline } from "./lib/changelog";
import { RELEASES_URL } from "./lib/releases";

function Text({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
            {p.text}
          </a>
        ) : p.code ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">
            {p.text}
          </code>
        ) : p.bold ? (
          <strong key={i} className="font-medium text-foreground">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function Changelog() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Nav current="changelog" />
      <main id="main" className="mx-auto max-w-[1120px] px-5 pt-20 pb-28 md:pt-28">
        <h1 className="text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.03] font-medium tracking-[-0.04em]">Changelog</h1>
        <p className="mt-4 max-w-[56ch] text-[15.5px] leading-relaxed text-muted-foreground">
          Every Systo release, newest first. Installed copies update themselves; downloads and checksums live on{" "}
          <a href={RELEASES_URL} className="inline-flex items-center gap-0.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
            GitHub Releases <ArrowUpRightIcon className="size-3.5" />
          </a>
          .
        </p>

        <ol className="mt-16 divide-y border-t">
          {RELEASES.map((release) => (
            <li key={release.version} id={`v${release.version}`} className="grid gap-6 py-12 md:grid-cols-[220px_1fr] md:gap-10">
              <div className="md:sticky md:top-24 md:self-start">
                <h2 className="text-[22px] font-medium tracking-[-0.02em] tnum">
                  <a href={`#v${release.version}`} className="hover:underline">
                    {release.version}
                  </a>
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground tnum">{release.unreleased ? "Unreleased" : formatDate(release.date)}</p>
                {!release.unreleased && (
                  <a href={`${RELEASES_URL}/tag/v${release.version}`} className="mt-3 inline-flex items-center gap-1 text-[13px] text-foreground hover:underline">
                    Download <ArrowUpRightIcon className="size-3.5" />
                  </a>
                )}
              </div>
              <div className="max-w-[68ch] space-y-8">
                {release.sections.map((section) => (
                  <section key={section.title}>
                    <h3 className="text-[12px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{section.title}</h3>
                    <ul className="mt-3 space-y-2.5 text-[15px] leading-relaxed text-muted-foreground">
                      {section.items.map((item, i) => (
                        <li key={i} className="relative pl-4 before:absolute before:top-[0.7em] before:left-0 before:size-1 before:rounded-full before:bg-border">
                          <Text parts={item} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Changelog />
  </StrictMode>,
);
