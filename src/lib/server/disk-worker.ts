/**
 * The disk scanner. Like the native reader it's self-contained, so it can be serialized with
 * Function#toString and run in `bun -e` workers: it must not close over imports.
 *
 * It walks depth-first with getattrlistbulk(2), which returns names, types and allocated sizes for
 * a whole directory per call, and prunes small entries as each directory finishes so memory stays
 * bounded even on a volume with tens of millions of files.
 */

export interface DiskNode {
  /** Name; empty for the aggregate of pruned small items. */
  n: string;
  /** Allocated bytes. */
  s: number;
  /** Files contained. */
  f: number;
  /** 0 file, 1 folder, 2 package (an .app or library that Finder shows as one item), 3 aggregate. */
  k: 0 | 1 | 2 | 3;
  c?: DiskNode[];
  /** Folders a "list" request didn't descend into. */
  pending?: Array<{ name: string; kind: 1 | 2 }>;
}

export interface DiskScanRequest {
  id: number;
  path: string;
  /** "list" reads one directory; "tree" scans everything beneath it. */
  mode: "list" | "tree";
  dev: number;
  minKeep: number;
  maxChildren: number;
}

export interface DiskScanResult {
  id: number;
  node: DiskNode;
  topFiles: Array<{ p: string; s: number }>;
  categories: Record<string, { size: number; count: number }>;
  files: number;
  dirs: number;
  bytes: number;
  denied: number;
}

export function createDiskScanner(
  ffi: null | {
    dlopen: (path: string, symbols: Record<string, unknown>) => { symbols: Record<string, (...args: any[]) => any> };
    ptr: (view: ArrayBufferView) => number;
  },
  /** node:fs, passed in because this function is serialized into workers. */
  fs: Pick<typeof import("node:fs"), "readdirSync" | "lstatSync">,
) {
  const lib =
    process.platform === "darwin" && ffi
      ? ffi.dlopen("/usr/lib/libSystem.B.dylib", {
          open: { args: ["ptr", "i32"], returns: "i32" },
          close: { args: ["i32"], returns: "i32" },
          getattrlistbulk: { args: ["i32", "ptr", "ptr", "usize", "u64"], returns: "i32" },
        }).symbols
      : null;

  const ATTR_CMN_NAME = 0x1;
  const ATTR_CMN_DEVID = 0x2;
  const ATTR_CMN_OBJTYPE = 0x8;
  const ATTR_CMN_FILEID = 0x02000000;
  const ATTR_CMN_ERROR = 0x20000000;
  const ATTR_CMN_RETURNED_ATTRS = 0x80000000;
  const ATTR_FILE_LINKCOUNT = 0x1;
  const ATTR_FILE_ALLOCSIZE = 0x4;
  const FSOPT_NOFOLLOW = 0x1;
  const FSOPT_PACK_INVAL_ATTRS = 0x8;
  const O_RDONLY_DIRECTORY = 0x100000;
  const VREG = 1;
  const VDIR = 2;

  // struct attrlist { u_short bitmapcount; u_int16_t reserved; attrgroup_t common, vol, dir, file, fork; }
  const attrList = new DataView(new ArrayBuffer(24));
  attrList.setUint16(0, 5, true);
  attrList.setUint32(4, (ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_NAME | ATTR_CMN_DEVID | ATTR_CMN_OBJTYPE | ATTR_CMN_FILEID | ATTR_CMN_ERROR) >>> 0, true);
  attrList.setUint32(16, ATTR_FILE_LINKCOUNT | ATTR_FILE_ALLOCSIZE, true);
  const attrPtr = ffi ? ffi.ptr(attrList) : 0;

  const BUF_SIZE = 256 * 1024;
  const buf = new Uint8Array(BUF_SIZE);
  const view = new DataView(buf.buffer);
  const bufPtr = ffi ? ffi.ptr(buf) : 0;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const PACKAGE_EXT =
    /\.(app|bundle|framework|photoslibrary|musiclibrary|tvlibrary|fcpbundle|imovielibrary|xcarchive|plugin|kext|appex|rtfd|pages|numbers|key|logicx|band|sparsebundle|vmwarevm|pvm|utm)$/i;

  const CATEGORY: Array<[string, RegExp]> = [
    ["video", /\.(mp4|mov|m4v|mkv|avi|webm|mts|m2ts|braw|r3d)$/i],
    ["images", /\.(jpe?g|png|heic|heif|gif|tiff?|bmp|webp|cr2|cr3|nef|arw|dng|psd|ai|sketch|fig|svg)$/i],
    ["audio", /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|caf)$/i],
    ["archives", /\.(zip|tar|gz|tgz|bz2|xz|zst|7z|rar|dmg|iso|pkg|xip|ipsw|sparseimage|img)$/i],
    ["documents", /\.(pdf|docx?|xlsx?|pptx?|pages|numbers|key|txt|md|rtf|epub|csv)$/i],
    ["code", /\.(js|mjs|cjs|ts|tsx|jsx|json|map|py|pyc|rb|go|rs|swift|c|cc|cpp|h|hpp|m|java|kt|class|jar|o|a|dylib|so|wasm|node|lock|pack|idx)$/i],
    ["vm", /\.(vmdk|vdi|qcow2|vhdx?|raw)$/i],
  ];
  const categoryFor = (name: string) => {
    for (const [id, re] of CATEGORY) if (re.test(name)) return id;
    return "other";
  };

  const TOP_FILES = 150;
  const trimSlash = (p: string) => (p.endsWith("/") ? p.slice(0, -1) : p);

  return function scan(request: DiskScanRequest, onProgress: (p: { files: number; dirs: number; bytes: number; current: string }) => void): DiskScanResult {
    const categories: Record<string, { size: number; count: number }> = {};
    let topFiles: Array<{ p: string; s: number }> = [];
    let topMin = 1024 * 1024;
    const seenLinks = new Set<number>();
    let files = 0;
    let dirs = 0;
    let bytes = 0;
    let denied = 0;
    let lastEmit = 0;

    type OnDir = (name: string, dev: number) => void;
    type OnFile = (name: string, alloc: number, links: number, fileId: number) => void;

    /** macOS: names, types and allocated sizes for a whole directory per getattrlistbulk call. */
    const readDirMac = (path: string, onDir: OnDir, onFile: OnFile): boolean => {
      const fd = lib!.open(ffi!.ptr(encoder.encode(path + "\0")), O_RDONLY_DIRECTORY);
      if (fd < 0) return false;
      try {
        for (;;) {
          const count = lib!.getattrlistbulk(fd, attrPtr, bufPtr, BUF_SIZE, FSOPT_NOFOLLOW | FSOPT_PACK_INVAL_ATTRS);
          if (count <= 0) {
            if (count < 0) denied++;
            break;
          }
          let entry = 0;
          for (let i = 0; i < count; i++) {
            const length = view.getUint32(entry, true);
            // length(4) returned(20) error(4) name(8) devid(4) objtype(4) fileid(8) linkcount(4) allocsize(8)
            const o = entry + 24;
            const error = view.getUint32(o, true);
            const nameStart = o + 4 + view.getInt32(o + 4, true);
            const nameLength = view.getUint32(o + 8, true);
            const dev = view.getInt32(o + 12, true);
            const type = view.getUint32(o + 16, true);
            entry += length;
            if (error) {
              denied++;
              continue;
            }
            const entryName = decoder.decode(buf.subarray(nameStart, nameStart + Math.max(0, nameLength - 1)));
            if (type === VDIR) onDir(entryName, dev);
            else if (type === VREG) {
              onFile(entryName, Number(view.getBigInt64(o + 32, true)), view.getUint32(o + 28, true), Number(view.getBigUint64(o + 20, true)));
            }
          }
        }
      } finally {
        lib!.close(fd);
      }
      return true;
    };

    /** Windows: readdir plus one lstat per file. Junctions and symlinks aren't followed. */
    const readDirFs = (path: string, onDir: OnDir, onFile: OnFile): boolean => {
      let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
      try {
        entries = fs.readdirSync(path, { withFileTypes: true }) as typeof entries;
      } catch {
        return false;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          onDir(entry.name, request.dev);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          const stat = fs.lstatSync(`${trimSlash(path)}/${entry.name}`);
          onFile(entry.name, stat.size, stat.nlink, stat.ino);
        } catch {
          denied++;
        }
      }
      return true;
    };

    const readDir = lib ? readDirMac : readDirFs;

    const prune = (children: DiskNode[]): DiskNode[] => {
      children.sort((a, b) => b.s - a.s);
      const kept: DiskNode[] = [];
      let restSize = 0;
      let restFiles = 0;
      for (const child of children) {
        if (child.s >= request.minKeep && kept.length < request.maxChildren) kept.push(child);
        else {
          restSize += child.s;
          restFiles += child.f;
        }
      }
      if (restSize > 0) kept.push({ n: "", s: restSize, f: restFiles, k: 3 });
      return kept;
    };

    const walk = (path: string, name: string, kind: 1 | 2, recurse: boolean): DiskNode => {
      const node: DiskNode = { n: name, s: 0, f: 0, k: kind };
      dirs++;
      const subdirs: Array<{ name: string; kind: 1 | 2 }> = [];
      const children: DiskNode[] = [];
      const onDir = (entryName: string, dev: number) => {
        if (dev === request.dev) subdirs.push({ name: entryName, kind: PACKAGE_EXT.test(entryName) ? 2 : 1 });
      };
      const onFile = (entryName: string, alloc: number, links: number, fileId: number) => {
        if (links > 1 && fileId) {
          if (seenLinks.has(fileId)) return;
          seenLinks.add(fileId);
        }
        files++;
        bytes += alloc;
        node.f++;
        node.s += alloc;
        const bucket = (categories[categoryFor(entryName)] ??= { size: 0, count: 0 });
        bucket.size += alloc;
        bucket.count++;
        if (alloc > 0) children.push({ n: entryName, s: alloc, f: 1, k: 0 });
        if (alloc > topMin) {
          topFiles.push({ p: `${trimSlash(path)}/${entryName}`, s: alloc });
          if (topFiles.length > TOP_FILES * 2) {
            topFiles.sort((a, b) => b.s - a.s);
            topFiles = topFiles.slice(0, TOP_FILES);
            topMin = topFiles[topFiles.length - 1].s;
          }
        }
      };
      if (!readDir(path, onDir, onFile)) {
        denied++;
        node.c = [];
        return node;
      }
      const now = Date.now();
      if (now - lastEmit > 150) {
        lastEmit = now;
        onProgress({ files, dirs, bytes, current: path });
      }
      if (!recurse) {
        node.c = prune(children);
        node.pending = subdirs;
        return node;
      }
      for (const sub of subdirs) {
        const child = walk(`${trimSlash(path)}/${sub.name}`, sub.name, sub.kind, true);
        node.s += child.s;
        node.f += child.f;
        children.push(child);
      }
      node.c = prune(children);
      return node;
    };

    const name = trimSlash(request.path).slice(trimSlash(request.path).lastIndexOf("/") + 1) || request.path;
    const node = walk(request.path, name, 2 - Number(!PACKAGE_EXT.test(name)) as 1 | 2, request.mode === "tree");
    topFiles.sort((a, b) => b.s - a.s);
    onProgress({ files, dirs, bytes, current: request.path });
    return { id: request.id, node, topFiles: topFiles.slice(0, TOP_FILES), categories, files, dirs, bytes, denied };
  };
}
