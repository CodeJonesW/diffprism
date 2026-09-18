/**
 * The build journal entry format — one markdown file per change in
 * `docs/journal/entries/`, recording what changed and why in plain language.
 * See docs/journal/README.md for the format and how entries become posts.
 */

export const KINDS = ["feature", "fix", "decision", "infra"] as const;
export type Kind = (typeof KINDS)[number];

/** Sections in the order they must appear. */
export const SECTIONS = [
  { heading: "What changed", required: true },
  { heading: "Why", required: true },
  { heading: "Decisions", required: false },
  { heading: "What we learned", required: false },
] as const;

export interface JournalEntry {
  file: string;
  title: string;
  date: string;
  kind: Kind;
  pr: number | null;
  /** Section heading → body, in file order. */
  sections: Map<string, string>;
}

export type ParseResult = { entry: JournalEntry; problems: [] } | { entry: null; problems: string[] };

const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = new Set(["title", "date", "kind", "pr"]);

export function parseEntry(file: string, text: string): ParseResult {
  const problems: string[] = [];
  const name = file.split("/").pop()!;
  const nameMatch = name.match(FILE_NAME);
  if (!nameMatch) problems.push(`file name must be YYYY-MM-DD-kebab-slug.md`);

  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return { entry: null, problems: [...problems, "missing --- frontmatter --- block"] };

  const fields = new Map<string, string>();
  for (const line of fm[1].split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.+?)\s*$/);
    if (!kv) {
      problems.push(`frontmatter line is not \`key: value\`: ${JSON.stringify(line)}`);
      continue;
    }
    if (!KEYS.has(kv[1])) problems.push(`unknown frontmatter key \`${kv[1]}\``);
    else if (fields.has(kv[1])) problems.push(`duplicate frontmatter key \`${kv[1]}\``);
    else fields.set(kv[1], kv[2]);
  }

  const title = fields.get("title");
  const date = fields.get("date");
  const kind = fields.get("kind");
  const pr = fields.get("pr");
  if (!title) problems.push("missing `title`");
  if (!date || !DATE.test(date) || Number.isNaN(Date.parse(date))) problems.push("`date` must be YYYY-MM-DD");
  else if (nameMatch && nameMatch[1] !== date) problems.push(`file name date ${nameMatch[1]} does not match \`date: ${date}\``);
  if (!KINDS.includes(kind as Kind)) problems.push(`\`kind\` must be one of ${KINDS.join(", ")}`);
  if (pr !== undefined && !/^[1-9]\d*$/.test(pr)) problems.push("`pr` must be a PR number");

  const sections = new Map<string, string>();
  const body = text.slice(fm[0].length);
  const parts = body.split(/^## (.+)$/m);
  if (parts[0].trim()) problems.push("text before the first `## ` section");
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim();
    if (!SECTIONS.some((s) => s.heading === heading)) problems.push(`unknown section \`## ${heading}\``);
    else if (sections.has(heading)) problems.push(`duplicate section \`## ${heading}\``);
    else if (!parts[i + 1].trim()) problems.push(`section \`## ${heading}\` is empty`);
    else sections.set(heading, parts[i + 1].trim());
  }
  for (const s of SECTIONS) {
    if (s.required && !sections.has(s.heading)) problems.push(`missing section \`## ${s.heading}\``);
  }
  const order = [...sections.keys()].map((h) => SECTIONS.findIndex((s) => s.heading === h));
  if (order.some((n, i) => i > 0 && n < order[i - 1])) {
    problems.push(`sections must be in order: ${SECTIONS.map((s) => s.heading).join(", ")}`);
  }

  if (problems.length > 0) return { entry: null, problems };
  return {
    entry: { file, title: title!, date: date!, kind: kind as Kind, pr: pr ? Number(pr) : null, sections },
    problems: [],
  };
}

export interface ExportFilter {
  since?: string;
  until?: string;
  kinds?: Kind[];
}

export function selectEntries(entries: JournalEntry[], filter: ExportFilter): JournalEntry[] {
  return entries
    .filter((e) => (!filter.since || e.date >= filter.since) && (!filter.until || e.date <= filter.until))
    .filter((e) => !filter.kinds || filter.kinds.includes(e.kind))
    .sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file));
}

/** One markdown bundle of entries, oldest first — the raw material for a blog post. */
export function renderBundle(entries: JournalEntry[], repoUrl: string): string {
  if (entries.length === 0) return "";
  const range = `${entries[0].date} to ${entries[entries.length - 1].date}`;
  const out = [`# DiffPrism build journal, ${range}`, "", `${entries.length} entries.`, ""];
  for (const e of entries) {
    const pr = e.pr ? ` · [#${e.pr}](${repoUrl}/pull/${e.pr})` : "";
    out.push(`## ${e.title}`, "", `*${e.date} · ${e.kind}${pr}*`, "");
    for (const [heading, text] of e.sections) out.push(`### ${heading}`, "", text, "");
  }
  return out.join("\n");
}
