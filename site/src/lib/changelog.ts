import source from "../../../CHANGELOG.md?raw";

/** CHANGELOG.md, parsed at build time: the same file the release workflow publishes as notes. */

export interface Inline {
  text: string;
  bold?: boolean;
  code?: boolean;
  href?: string;
}

export interface ChangeSection {
  title: string;
  items: Inline[][];
}

export interface Release {
  version: string;
  date: string;
  unreleased: boolean;
  sections: ChangeSection[];
}

function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`|\[(.+?)\]\((.+?)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1]) out.push({ text: m[1], bold: true });
    else if (m[2]) out.push({ text: m[2], code: true });
    else out.push({ text: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export const RELEASES: Release[] = (() => {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: ChangeSection | null = null;
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const head = /^## \[(.+?)\](?:\s*-\s*(.+))?$/.exec(line);
    if (head) {
      release = { version: head[1], date: head[2]?.trim() ?? "", unreleased: /unreleased/i.test(head[2] ?? ""), sections: [] };
      releases.push(release);
      section = null;
      continue;
    }
    if (!release) continue;
    const sub = /^### (.+)$/.exec(line);
    if (sub) {
      section = { title: sub[1], items: [] };
      release.sections.push(section);
      continue;
    }
    const item = /^- (.+)$/.exec(line);
    if (item && section) section.items.push(inline(item[1]));
  }
  return releases;
})();

export function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });
}
