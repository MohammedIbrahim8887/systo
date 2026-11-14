"use client";

import { memo, useState } from "react";
import {
  AppWindowIcon,
  BlocksIcon,
  CommandIcon,
  CpuIcon,
  LayersIcon,
  PanelTopIcon,
  PlugIcon,
  ServerCogIcon,
  SettingsIcon,
  SquareTerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProcessKind } from "@/lib/types";

export const KIND_ICON: Record<ProcessKind, LucideIcon> = {
  app: AppWindowIcon,
  "system-app": CommandIcon,
  "menu-bar": PanelTopIcon,
  helper: LayersIcon,
  developer: SquareTerminalIcon,
  "third-party-service": PlugIcon,
  "user-service": SettingsIcon,
  "system-service": ServerCogIcon,
  kernel: CpuIcon,
};

const failed = new Set<string>();

interface AppIconProps {
  bundlePath?: string;
  hasIcon?: boolean;
  kind: ProcessKind;
  size?: number;
  color?: boolean;
  className?: string;
}

export const AppIcon = memo(function AppIcon({ bundlePath, hasIcon, kind, size = 18, color = false, className }: AppIconProps) {
  const [broken, setBroken] = useState(() => (bundlePath ? failed.has(bundlePath) : true));
  const Glyph = KIND_ICON[kind] ?? BlocksIcon;
  if (bundlePath && hasIcon !== false && !broken) {
    return (
      <img
        src={`/api/icon?path=${encodeURIComponent(bundlePath)}`}
        alt=""
        width={size}
        height={size}
        draggable={false}
        loading="lazy"
        onError={() => {
          failed.add(bundlePath);
          setBroken(true);
        }}
        className={cn(
          "shrink-0 object-contain transition-[filter,opacity] duration-200",
          !color && "opacity-90 grayscale group-hover/row:opacity-100 group-hover/row:grayscale-0 dark:contrast-[1.05]",
          className,
        )}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground", className)}
      style={{ width: size, height: size }}
    >
      <Glyph style={{ width: size * 0.62, height: size * 0.62 }} strokeWidth={1.75} />
    </span>
  );
});
