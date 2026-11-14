---
name: Systo
description: Monochrome system monitoring with the approved Core identity and Island Preview installer.
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
  installer-button-hover: "#303030"
  installer-button-disabled: "#414141"
  installer-focus: "#777"
  preview-bezel: "#090909"
  preview-screen: "#e9e9e9"
  preview-ink: "#fafafa"
typography:
  app-body:
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif'
  app-mono:
    fontFamily: '"Geist Mono Variable", ui-monospace, monospace'
  installer-headline:
    fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "clamp(32px,4.9vw,48px)"
    fontWeight: 640
    lineHeight: 1.12
    letterSpacing: "-.035em"
  installer-wordmark:
    fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "36px"
    fontWeight: 620
    letterSpacing: "-.035em"
  installer-support:
    fontSize: "23px"
    lineHeight: 1.35
    letterSpacing: "-.02em"
  installer-action:
    fontSize: "21px"
    fontWeight: 600
    letterSpacing: "-.02em"
  preview-metric:
    fontSize: "14px"
    fontWeight: 570
rounded:
  app-base: "0.625rem"
  installer-action: "15px"
  preview-island: "28px"
  preview-display: "46px 46px 0 0"
  preview-bezel: "36px 36px 0 0"
  preview-screen: "25px 25px 0 0"
spacing:
  installer-content: "20px 42px 12px"
  installer-content-compact: "18px 22px"
  preview-island: "16px 22px"
  brand-gap: "12px"
  metric-gap: "9px"
components:
  installer-primary:
    backgroundColor: "{colors.installer-ink}"
    textColor: "{colors.installer-background}"
    typography: "{typography.installer-action}"
    rounded: "{rounded.installer-action}"
    width: "330px"
  installer-primary-hover:
    backgroundColor: "{colors.installer-button-hover}"
  installer-primary-disabled:
    backgroundColor: "{colors.installer-button-disabled}"
    textColor: "#eee"
  preview-island:
    backgroundColor: "linear-gradient(#202020,#060606)"
    textColor: "{colors.preview-ink}"
    rounded: "{rounded.preview-island}"
    padding: "{spacing.preview-island}"
---

# Design System: Systo

## Overview

The approved identity is **Core**; the approved installer composition is **Island Preview**. This is an extension of the existing monochrome interface, not a replacement design system. The desktop installer runs offline in an AppKit window containing WKWebView; the main application retains its existing light and dark themes.

References: `assets/design/core-reference.png` and `assets/design/installer-reference.png`. Implementation sources: `installer/index.html`, `installer/main.swift`, and `src/app/globals.css`. Product commitments live in `PRODUCT.md`.

## Colors

Neutral surfaces, grayscale text, and black primary actions carry the interface. The installer uses a white canvas and fixed light appearance. The application's canonical OKLCH theme variables remain authoritative; installer hex values belong to that surface only. Metrics and errors stay monochrome, with labels and weight communicating meaning.

## Typography

Geist is the shared sans-serif family. The application additionally uses Geist Mono and enables `ss01` and `cv11`. The installer bundles a variable Geist font, balances its centered headline, and uses tabular numerals for preview metrics. Supporting destination text is 12px; status text is 13px with 1.4 line height; the illustrative-data caption is 11px.

## Layout

The installer has a fixed 920 × 650 content window with native title, close, and minimize controls. Content has a 1100px maximum width and the padding recorded above. Its sequence is Core wordmark, centered headline, cropped Mac display and notch, supporting line, primary action, destination, and status.

The display illustration is 252px tall; its notch is 146 × 25px. The brand icon is 76px square. The primary action has a 58px minimum height and a 100% maximum width. At widths up to 650px the content padding contracts, the icon becomes 64px, the display 220px tall, the wordmark 30px, and supporting copy 19px. This fallback does not make the desktop installer a mobile product.

## Elevation & Depth

The application relies on neutral tonal separation. The installer illustration alone uses a metallic display gradient, layered bezel, pale wallpaper, and a white fade. Its floating island has `0 8px 14px #0002` shadow. These illustration treatments do not introduce gradients or raised decorative cards throughout the application.

## Shapes

Core consists of four rounded quadrants around a central cross-shaped negative space. Preserve the approved silhouette and monochrome treatment using the shipped `assets/icon.png`. The installer pairs rounded display corners with a capsule-like island and a softly rounded primary button. The application's base radius remains unchanged.

## Components

**Core brand.** Place the asset beside the Systo wordmark with a 12px gap; the installer uses a 72px-high brand row and an 8px negative left icon margin. The reference sheet is design evidence, not the shipped icon.

**Installation action.** One dominant button progresses from “Install Systo” to “Installing Systo…” and then “Open Systo”; failure offers “Try Again” with readable status. While copying, disable installation and destination controls and show an indeterminate spinner. Use a 3px neutral focus outline offset 4px and a 1px pressed translation. The secondary “Change…” action opens a native folder picker. Existing installations require a native replacement confirmation.

**Island preview.** CPU 12% and Memory 42% are explicitly illustrative values. The caption and accessible image description identify the preview. Metrics use icons, text, and small bars; they do not claim to be live measurements.

**Status and native behavior.** Announce updates through a polite live region. Close and quit are temporarily blocked during copying and restored afterward. Honor reduced motion by removing installer transitions and animation.

## Do's and Don'ts

- Do preserve the existing application palette, themes, typography, and density.
- Do use the approved Core asset and Island Preview composition for the installer.
- Do retain native window controls, keyboard focus, and honest installation states.
- Don't introduce a colored accent or extrapolate the installer illustration into an application redesign.
- Don't present illustrative metrics as live data or show fabricated percentage progress.
