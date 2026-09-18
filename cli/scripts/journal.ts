/**
 * The build journal: validate entries, and export them as one markdown bundle
 * to draft a blog post from.
 *
 * Run:
 *   pnpm journal check                      # every entry is well formed
 *   pnpm journal check --base origin/main   # …and this branch adds or edits one
 *   pnpm journal export --since 2026-09-01 [--until …] [--kind feature,fix]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { KINDS, parseEntry, renderBundle, selectEntries, type JournalEntry, type Kind } from "./journal-entry.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENTRIES_DIR = "docs/journal/entries";
const REPO_URL = "https://github.com/CodeJonesW/diffprism";

function readEntries(): { entries: JournalEntry[]; problems: string[] } {
  const dir = path.join(ROOT, ENTRIES_DIR);
  const entries: JournalEntry[] = [];
  const problems: string[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const file = `${ENTRIES_DIR}/${name}`;
    const result = parseEntry(file, fs.readFileSync(path.join(ROOT, file), "utf8"));
    if (result.entry) entries.push(result.entry);
    else problems.push(...result.problems.map((p) => `${file}: ${p}`));
  }
  return { entries, problems };
}

function changedEntries(base: string): string[] {
  return execFileSync("git", ["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`, "--", ENTRIES_DIR], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith(".md"));
}

function check(base: string | undefined): void {
  const { entries, problems } = readEntries();
  if (base && changedEntries(base).length === 0) {
    problems.push(
      `this branch adds no entry to ${ENTRIES_DIR}/ — record what changed and why (see docs/journal/README.md)`,
    );
  }
  for (const p of problems) {
    console.log(p);
    if (process.env.GITHUB_ACTIONS) console.log(`::error::${p}`);
  }
  if (problems.length > 0) process.exit(1);
  console.log(`Journal OK: ${entries.length} entries.`);
}

function exportBundle(values: { since?: string; until?: string; kind?: string }): void {
  const kinds = values.kind?.split(",").map((k) => k.trim());
  const unknown = kinds?.filter((k) => !KINDS.includes(k as Kind));
  if (unknown?.length) throw new Error(`unknown kind ${unknown.join(", ")} — expected ${KINDS.join(", ")}`);
  const { entries, problems } = readEntries();
  if (problems.length > 0) throw new Error(`fix the journal first (pnpm journal check):\n${problems.join("\n")}`);
  const selected = selectEntries(entries, { since: values.since, until: values.until, kinds: kinds as Kind[] | undefined });
  if (selected.length === 0) throw new Error("no entries match");
  process.stdout.write(renderBundle(selected, REPO_URL));
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { base: { type: "string" }, since: { type: "string" }, until: { type: "string" }, kind: { type: "string" } },
});

switch (positionals[0]) {
  case "check":
    check(values.base);
    break;
  case "export":
    exportBundle(values);
    break;
  default:
    console.error("usage: pnpm journal check [--base <ref>] | export [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--kind k1,k2]");
    process.exit(1);
}
