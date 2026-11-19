export interface IslandPosition {
  x: number;
  y: number;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const fraction = (value: number) => Math.max(0, Math.min(1, value));

/** Store fractions of the usable travel so the panel stays reachable after a display change. */
export class FloatingPosition {
  private position: IslandPosition;
  private lastDrag = 0;

  // Recover hover if the webview reloads or the final pointer request never reaches the shell.
  get dragging() {
    return Date.now() - this.lastDrag < 2000;
  }

  set dragging(active: boolean) {
    this.lastDrag = active ? Date.now() : 0;
  }

  constructor(saved?: IslandPosition, private save?: (position: IslandPosition) => void) {
    this.position = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? { x: fraction(saved.x), y: fraction(saved.y) }
      : { x: 0.5, y: 0 };
  }

  layout(bounds: Bounds, width: number, height: number, dx = 0, dy = 0) {
    const travelX = Math.max(0, bounds.right - bounds.left - width);
    const travelY = Math.max(0, bounds.bottom - bounds.top - height);
    if (dx && travelX) this.position.x = fraction(this.position.x + dx / travelX);
    if (dy && travelY) this.position.y = fraction(this.position.y + dy / travelY);
    return {
      x: Math.round(bounds.left + travelX * this.position.x),
      y: Math.round(bounds.top + travelY * this.position.y),
    };
  }

  finish() {
    this.dragging = false;
    this.save?.({ ...this.position });
  }
}
