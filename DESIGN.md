---
name: Systo
description: Monochrome system monitoring with the approved Core identity and Quiet Install installer.
colors:
  app-background: "oklch(1 0 0)"
  app-foreground: "oklch(0.145 0 0)"
  app-primary: "oklch(0.205 0 0)"
  app-muted: "oklch(0.97 0 0)"
  app-muted-foreground: "oklch(0.52 0 0)"
  app-border: "oklch(0.92 0 0)"
  app-dark-background: "oklch(0.155 0 0)"
  app-dark-foreground: "oklch(0.96 0 0)"
  app-dark-primary: "oklch(0.94 0 0)"
  installer-background: "#fff"
  installer-ink: "#111"
  installer-secondary: "#626262"
  installer-line: "#dedede"
  installer-hover: "#f7f7f7"
  installer-drop: "#f4f4f4"
  installer-focus: "#777"
typography:
  app-body:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif'
  app-mono:
    fontFamily: '"Geist Mono Variable", ui-monospace, monospace'
  installer-headline:
    fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "60px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-.035em"
  installer-wordmark:
    fontSize: "25px"
    fontWeight: 650
  installer-subtitle:
    fontSize: "30px"
    letterSpacing: "-.025em"
  installer-label:
    fontSize: "25px"
    fontWeight: 620
    letterSpacing: "-.02em"
  installer-instruction:
    fontSize: "23px"
    fontWeight: 500
    letterSpacing: "-.02em"
rounded:
  app-base: "0.625rem"
  installer-tile: "16px"
spacing:
  installer-content: "30px 48px 0"
  installer-content-compact: "24px 24px 0"
  installer-transfer-gap: "50px"
  installer-brand-gap: "8px"
components:
  installer-tile:
    backgroundColor: "transparent"
    textColor: "{colors.installer-ink}"
    typography: "{typography.installer-label}"
    rounded: "{rounded.installer-tile}"
    width: "220px"
  installer-tile-hover:
    backgroundColor: "{colors.installer-hover}"
  installer-tile-drop:
    backgroundColor: "{colors.installer-drop}"
---

# Design System: Systo

## Overview

**Creative North Star: "Core identity · Quiet Install"**

The approved monochrome Core identity carries through the application and the installer. The user’s Quiet Install reference replaces the earlier Island Preview installer composition. The main application retains its existing light and dark themes; the desktop installer uses a fixed light appearance in an offline AppKit window containing WKWebView.

Implementation sources: `installer/index.html`, `installer/main.swift`, and `src/app/globals.css`. The Core reference remains `assets/design/core-reference.png`; `assets/design/installer-reference.png` records the superseded Island Preview concept. The current installer brief is `installer/BRIEF.md`.

## Colors

White surfaces, dark text and neutral separators carry the installer. The macOS Applications folder asset is rendered in grayscale, and hover/drop states use pale neutral fills. The application's canonical OKLCH theme variables remain authoritative; installer hex values belong only to that surface.

**Preserve application identity.** Installer treatments do not replace the existing application light and dark themes.

## Typography

Geist is the shared sans-serif family. The application additionally uses Geist Mono and enables `ss01` and `cv11`. The installer bundles variable Geist and uses an oversized centered headline, lighter subtitle, prominent icon labels, and a smaller instruction line. Destination controls use 12px text; live status uses 13px text with 1.4 line height. The footer is 21px.

## Layout

The installer has a fixed 920 × 650 content window with native title, close, and minimize controls. A centered 54px brand strip precedes the headline and subtitle. A horizontal transfer row places the Core app icon, directional arrow, and Applications folder above the installation instruction, destination control, live status, and separated footer.

The brand icon is 36px square. Installation icons are 220px square, with a 60px arrow between them. At widths up to 700px, the headline contracts to 46px, subtitle to 24px, icons to 180px, labels to 22px, arrow to 40px, and transfer gap to 18px. This fallback does not make the desktop installer a mobile product.

## Elevation & Depth

The application relies on neutral tonal separation. The installer has a flat white canvas with subtle tonal shading in the brand strip and dimensionality supplied by the Core and native folder assets. It adds no CSS shadows to its tiles.

## Shapes

Core consists of four rounded quadrants around a central cross-shaped negative space. Preserve the approved silhouette and monochrome treatment using `assets/icon.png`. Installer tiles have softly rounded hit areas that become visible on hover or drag-over. The application's base radius remains unchanged.

## Components

**Core brand.** Center the supplied icon beside the Systo wordmark. The reference sheet is design evidence, not the shipped icon.

**Installation tiles.** Dragging the Core icon onto the Applications folder invokes the native installation flow. Clicking either tile supplies a keyboard-accessible alternative. The folder uses the host macOS Applications icon, exported during packaging and rendered in grayscale. Hover changes the tile fill; keyboard focus uses a 3px neutral outline offset 4px, and drag-over uses the same outline offset 6px.

**Destination action.** “Change folder…” opens a native folder picker. The chosen folder updates the destination label and instruction. Native replacement confirmation and safe staged copying remain part of the installation flow.

**Status and native behavior.** During copying, disable both tiles and the folder picker, dim the arrow, and show “Installing Systo…” with a polite live status. Errors provide a click-to-retry instruction. Completion changes the action to opening Systo and hides the destination controls. Close and quit are temporarily blocked during copying. No decorative animation or fabricated percentage progress is used.

## Do's and Don'ts

- Do preserve the existing application palette, themes, typography, and density.
- Do use the approved Core asset and Quiet Install composition for the installer.
- Do retain native window controls, keyboard focus, and honest installation states.
- Don't introduce a colored accent or extend the installer layout into an application redesign.
- Don't show fabricated installation percentages.
