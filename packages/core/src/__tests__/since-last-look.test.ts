import { describe, it, expect } from "vitest";
import { sinceLastLook } from "../since-last-look.js";
import type { DiffFile, DiffSet, Hunk } from "../types.js";

const hunk = (newStart: number, lines: Array<[" " | "+" | "-", string]>): Hunk => ({
  oldStart: newStart,
  oldLines: lines.filter(([t]) => t !== "+").length,
  newStart,
  newLines: lines.filter(([t]) => t !== "-").length,
  changes: lines.map(([t, content], i) => ({
    type: t === "+" ? "add" : t === "-" ? "delete" : "context",
    lineNumber: newStart + i,
    content,
  })),
});

const file = (path: string, hunks: Hunk[], extra: Partial<DiffFile> = {}): DiffFile => ({
  path,
  status: "modified",
  hunks,
  language: "typescript",
  binary: false,
  additions: 0,
  deletions: 0,
  ...extra,
});

const diff = (...files: DiffFile[]): DiffSet => ({ baseRef: "HEAD", headRef: "staged", files });

const cacheFix = hunk(12, [[" ", "const cache = new Map();"], ["+", "const TTL = 300_000;"]]);
const retryCap = hunk(40, [["-", "while (true) {"], ["+", "for (let i = 0; i < 3; i++) {"]]);

describe("sinceLastLook (#265)", () => {
  it("is empty when nothing changed", () => {
    expect(sinceLastLook(diff(file("a.ts", [cacheFix])), diff(file("a.ts", [cacheFix])))).toEqual([]);
  });

  it("names the new hunk in a file, with its lines and counts", () => {
    const seen = diff(file("a.ts", [cacheFix]));
    const now = diff(file("a.ts", [cacheFix, retryCap]));
    expect(sinceLastLook(seen, now)).toEqual([
      { key: "a.ts", path: "a.ts", status: "changed", hunks: [1], lines: [{ start: 41, end: 41 }], additions: 1, deletions: 1, droppedHunks: 0 },
    ]);
  });

  it("doesn't count a hunk as new just because a fix above it moved its lines", () => {
    const moved = { ...retryCap, oldStart: 44, newStart: 44, changes: retryCap.changes.map((c) => ({ ...c, lineNumber: c.lineNumber + 4 })) };
    const seen = diff(file("a.ts", [retryCap]));
    const now = diff(file("a.ts", [cacheFix, moved]));
    const [change] = sinceLastLook(seen, now);
    expect(change.hunks).toEqual([0]);
    // Only the line the fix added is cited, not the context around it.
    expect(change.lines).toEqual([{ start: 13, end: 13 }]);
  });

  it("says when a hunk the reviewer saw is gone", () => {
    const [change] = sinceLastLook(diff(file("a.ts", [cacheFix, retryCap])), diff(file("a.ts", [cacheFix])));
    expect(change).toMatchObject({ status: "changed", hunks: [], droppedHunks: 1 });
  });

  it("names files added to and removed from the diff", () => {
    const seen = diff(file("gone.ts", [cacheFix]));
    const now = diff(file("new.ts", [retryCap]));
    expect(sinceLastLook(seen, now).map((f) => [f.path, f.status])).toEqual([
      ["new.ts", "added"],
      ["gone.ts", "removed"],
    ]);
  });

  it("counts identical hunks, rather than letting one seen copy cover them all", () => {
    const guard = hunk(10, [["+", "if (!ready) return;"]]);
    const again = { ...guard, newStart: 30, oldStart: 29, changes: guard.changes.map((c) => ({ ...c, lineNumber: 30 })) };
    // A second, identical guard pasted elsewhere is new.
    const [added] = sinceLastLook(diff(file("a.ts", [guard])), diff(file("a.ts", [guard, again])));
    expect(added).toMatchObject({ hunks: [1], lines: [{ start: 30, end: 30 }] });
    // And removing one of two identical hunks is a change.
    const [removed] = sinceLastLook(diff(file("a.ts", [guard, again])), diff(file("a.ts", [guard])));
    expect(removed).toMatchObject({ hunks: [], droppedHunks: 1 });
  });

  it("doesn't count a hunk as new when only its context lines changed", () => {
    // An edit a few lines away rewrites the context git shows around this hunk.
    const seen = diff(file("a.ts", [hunk(12, [[" ", "const a = 1;"], ["+", "const TTL = 300_000;"]])]));
    const now = diff(file("a.ts", [hunk(12, [[" ", "const a = 2;"], ["+", "const TTL = 300_000;"]])]));
    expect(sinceLastLook(seen, now)).toEqual([]);
  });

  it("cites no line for a hunk that only deletes, but counts what it deleted", () => {
    const deletion = hunk(20, [["-", "debugger;"]]);
    const [change] = sinceLastLook(diff(file("a.ts", [])), diff(file("a.ts", [deletion])));
    expect(change).toMatchObject({ hunks: [0], lines: [], additions: 0, deletions: 1 });
  });

  it("keeps a working copy's staged and unstaged copies of a file apart", () => {
    const seen = diff(file("a.ts", [cacheFix], { stage: "staged" }));
    const now = diff(file("a.ts", [cacheFix], { stage: "staged" }), file("a.ts", [retryCap], { stage: "unstaged" }));
    expect(sinceLastLook(seen, now).map((f) => [f.key, f.status])).toEqual([["unstaged:a.ts", "added"]]);
  });
});
