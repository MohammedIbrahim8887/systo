/** AppKit overlay policy, isolated so native configuration can be regression-tested. */

/** NSWindowStyleMaskNonactivatingPanel: lets the panel float over other apps' full-screen Spaces. */
export const NONACTIVATING_PANEL = 1 << 7;

export function configureOverlay(set: (selector: string, value: number | boolean) => void) {
  set("setLevel:", 25);
  // all Spaces | stationary | ignores cycle | fullscreen auxiliary | joins all applications (macOS 13+)
  set("setCollectionBehavior:", (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8) | (1 << 18));
  set("setHidesOnDeactivate:", false);
  set("setHasShadow:", false);
  set("setOpaque:", false);
  set("setMovable:", false);
}

