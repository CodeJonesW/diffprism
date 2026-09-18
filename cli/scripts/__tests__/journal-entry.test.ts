import { describe, it, expect } from "vitest";
import { parseEntry, renderBundle, selectEntries, type JournalEntry } from "../journal-entry.js";

const FILE = "docs/journal/entries/2026-09-17-docs-drift-check.md";

function entryText(overrides: { frontmatter?: string; body?: string } = {}): string {
  const frontmatter = overrides.frontmatter ?? "title: Fail CI when docs drift\ndate: 2026-09-17\nkind: infra\npr: 192";
  const body = overrides.body ?? "## What changed\n\nCI checks the docs.\n\n## Why\n\nThey drifted.\n";
  return `---\n${frontmatter}\n---\n\n${body}`;
}

function parsed(file: string, text: string): JournalEntry {
  const result = parseEntry(file, text);
  expect(result.problems).toEqual([]);
  return result.entry!;
}

describe("parseEntry", () => {
  it("reads a well-formed entry", () => {
    const entry = parsed(FILE, entryText());
    expect(entry).toMatchObject({ title: "Fail CI when docs drift", date: "2026-09-17", kind: "infra", pr: 192 });
    expect([...entry.sections]).toEqual([
      ["What changed", "CI checks the docs."],
      ["Why", "They drifted."],
    ]);
  });

  it("allows an entry without a PR", () => {
    expect(parsed(FILE, entryText({ frontmatter: "title: T\ndate: 2026-09-17\nkind: decision" })).pr).toBeNull();
  });

  it("rejects missing fields, unknown keys and a bad kind", () => {
    const result = parseEntry(FILE, entryText({ frontmatter: "date: 2026-09-17\nkind: chore\nauthor: me" }));
    expect(result.problems).toEqual([
      "unknown frontmatter key `author`",
      "missing `title`",
      "`kind` must be one of feature, fix, decision, infra",
    ]);
  });

  it("requires the file name date to match the entry date", () => {
    const result = parseEntry("docs/journal/entries/2026-09-16-x.md", entryText());
    expect(result.problems).toEqual(["file name date 2026-09-16 does not match `date: 2026-09-17`"]);
  });

  it("requires What changed and Why, in order, and no other sections", () => {
    const result = parseEntry(FILE, entryText({ body: "## Why\n\nA.\n\n## Decisions\n\nB.\n\n## Notes\n\nC.\n" }));
    expect(result.problems).toEqual(["unknown section `## Notes`", "missing section `## What changed`"]);

    const outOfOrder = parseEntry(FILE, entryText({ body: "## Why\n\nA.\n\n## What changed\n\nB.\n" }));
    expect(outOfOrder.problems).toEqual(["sections must be in order: What changed, Why, Decisions, What we learned"]);
  });

  it("rejects empty sections", () => {
    const result = parseEntry(FILE, entryText({ body: "## What changed\n\n## Why\n\nA.\n" }));
    expect(result.problems).toEqual(["section `## What changed` is empty", "missing section `## What changed`"]);
  });
});

describe("export", () => {
  const a = parsed("docs/journal/entries/2026-09-10-a.md", entryText({ frontmatter: "title: A\ndate: 2026-09-10\nkind: feature\npr: 1" }));
  const b = parsed("docs/journal/entries/2026-09-12-b.md", entryText({ frontmatter: "title: B\ndate: 2026-09-12\nkind: fix" }));
  const c = parsed("docs/journal/entries/2026-09-11-c.md", entryText({ frontmatter: "title: C\ndate: 2026-09-11\nkind: feature" }));

  it("selects by date range and kind, oldest first", () => {
    expect(selectEntries([a, b, c], {}).map((e) => e.title)).toEqual(["A", "C", "B"]);
    expect(selectEntries([a, b, c], { since: "2026-09-11" }).map((e) => e.title)).toEqual(["C", "B"]);
    expect(selectEntries([a, b, c], { until: "2026-09-11", kinds: ["feature"] }).map((e) => e.title)).toEqual(["A", "C"]);
  });

  it("renders a bundle with dates, kinds and PR links", () => {
    const bundle = renderBundle([a, b], "https://github.com/o/r");
    expect(bundle).toContain("# DiffPrism build journal, 2026-09-10 to 2026-09-12");
    expect(bundle).toContain("## A\n\n*2026-09-10 · feature · [#1](https://github.com/o/r/pull/1)*");
    expect(bundle).toContain("## B\n\n*2026-09-12 · fix*\n\n### What changed\n\nCI checks the docs.");
  });
});
