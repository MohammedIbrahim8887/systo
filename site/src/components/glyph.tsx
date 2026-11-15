import {
  CloudIcon,
  CodeIcon,
  CpuIcon,
  FolderIcon,
  GlobeIcon,
  MailIcon,
  MessageSquareIcon,
  MusicIcon,
  PenToolIcon,
  SearchIcon,
  ShieldIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Glyph } from "../lib/demo";

const ICONS: Record<Glyph, LucideIcon> = {
  globe: GlobeIcon,
  message: MessageSquareIcon,
  pen: PenToolIcon,
  music: MusicIcon,
  code: CodeIcon,
  terminal: TerminalIcon,
  cloud: CloudIcon,
  search: SearchIcon,
  shield: ShieldIcon,
  cpu: CpuIcon,
  folder: FolderIcon,
  mail: MailIcon,
};

/** The app's monochrome icon tile, used where a real app icon would sit. */
export function GlyphTile({ glyph, size = 18, className }: { glyph: Glyph; size?: number; className?: string }) {
  const Icon = ICONS[glyph];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-[5px] bg-foreground/[0.07] text-foreground/75", className)}
      style={{ width: size, height: size }}
    >
      <Icon style={{ width: size * 0.62, height: size * 0.62 }} strokeWidth={1.8} />
    </span>
  );
}
