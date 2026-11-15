// Electrobun 2 ships its SDK through the Hutch devkit rather than node_modules, so the desktop
// hooks type-check against the small surface they use.

declare module "electrobun/main" {
  export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface Display {
    id: number;
    bounds: Rectangle;
    workArea: Rectangle;
    scaleFactor: number;
    isPrimary: boolean;
  }

  export class BrowserView {
    id: number;
    url: string | null;
    executeJavascript(js: string): void;
    loadURL(url: string): void;
    setNavigationRules(rules: string[]): void;
    on(name: "will-navigate" | "did-navigate" | "did-navigate-in-page" | "dom-ready", handler: (event: { data?: { detail?: unknown } }) => void): void;
  }

  export interface WindowOptions {
    title?: string;
    url?: string | null;
    html?: string | null;
    frame?: { x?: number; y?: number; width: number; height: number };
    titleBarStyle?: "hidden" | "hiddenInset" | "default";
    transparent?: boolean;
    passthrough?: boolean;
    hidden?: boolean;
    activate?: boolean;
    sandbox?: boolean;
    styleMask?: Record<string, boolean>;
  }

  export class BrowserWindow {
    constructor(options?: WindowOptions);
    id: number;
    readonly ptr: unknown;
    readonly webview: BrowserView;
    show(): void;
    showInactive(): void;
    hide(): void;
    close(): void;
    activate(): void;
    isVisible(): boolean;
    isMinimized(): boolean;
    unminimize(): void;
    setAlwaysOnTop(value: boolean): void;
    setVisibleOnAllWorkspaces(value: boolean): void;
    setFrame(x: number, y: number, width: number, height: number): void;
    on(name: "close" | "focus" | "blur" | "resize" | "move", handler: (event: unknown) => void): void;
  }

  export type MenuItemConfig =
    | { type: "divider" | "separator" }
    | { type: "normal"; label: string; action?: string; enabled?: boolean; checked?: boolean; tooltip?: string };

  export class Tray {
    constructor(options?: { title?: string; image?: string; template?: boolean; width?: number; height?: number });
    setTitle(title: string): void;
    setImage(path: string): void;
    setMenu(menu: MenuItemConfig[]): void;
    remove(): void;
    on(name: "tray-clicked", handler: (event: { data?: { action?: string } }) => void): void;
  }

  export const Screen: {
    getPrimaryDisplay(): Display;
    getAllDisplays(): Display[];
    getCursorScreenPoint(): { x: number; y: number };
  };

  export const Utils: {
    paths: { userData: string };
    quit(): void;
    openExternal(url: string): boolean;
  };

  const Electrobun: {
    events: { on(name: string, handler: (event: { data?: unknown; response?: unknown }) => void): void };
  };
  export interface UpdateInfo {
    version: string;
    hash: string;
    updateAvailable: boolean;
    updateReady: boolean;
    error: string;
  }

  export interface LocalUpdateInfo {
    version: string;
    hash: string;
    baseUrl: string;
    channel: string;
    name: string;
    identifier: string;
  }

  export const Updater: {
    getLocalInfo(): Promise<LocalUpdateInfo>;
    checkForUpdate(): Promise<UpdateInfo>;
    downloadUpdate(): Promise<void>;
    applyUpdate(): Promise<void>;
    updateInfo(): UpdateInfo;
    onStatusChange(
      callback: ((entry: { status: string; message: string; timestamp: number; details?: { progress?: number; errorMessage?: string } }) => void) | null,
    ): void;
  };

  export default Electrobun;
}

declare module "bun:ffi" {
  type FFIType = "ptr" | "i32" | "u32" | "i64" | "u64" | "u8" | "f64" | "bool" | "void" | "cstring";
  export function dlopen<T extends Record<string, { args: FFIType[]; returns: FFIType }>>(
    path: string,
    symbols: T,
  ): { symbols: { [K in keyof T]: (...args: any[]) => any }; close(): void };
  export function ptr(view: ArrayBufferView | ArrayBufferLike, byteOffset?: number): number;
  export function toArrayBuffer(pointer: number, byteOffset?: number, byteLength?: number): ArrayBuffer;
  export const read: {
    u8(pointer: number, byteOffset?: number): number;
    u32(pointer: number, byteOffset?: number): number;
    u64(pointer: number, byteOffset?: number): bigint;
    ptr(pointer: number, byteOffset?: number): number;
  };
}
