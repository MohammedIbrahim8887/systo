import type { AIProvider } from "@/lib/ai-types";
import { PROVIDER_MONOGRAM } from "@/lib/ai-display";
import { cn } from "@/lib/utils";

/** Monochrome provider monogram; Systo keeps provider identity typographic rather than branded. */
export function ProviderMark({ provider, size = "md", className }: { provider: AIProvider; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-md border bg-muted/60 font-mono font-medium tracking-tight text-foreground",
        size === "sm" && "size-6 text-[9.5px]",
        size === "md" && "size-8 text-[11px]",
        size === "lg" && "size-10 text-[13px]",
        className,
      )}
    >
      {PROVIDER_MONOGRAM[provider]}
    </span>
  );
}
