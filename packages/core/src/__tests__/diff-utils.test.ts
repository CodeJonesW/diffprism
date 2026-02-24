import { describe, it, expect } from "vitest";
import { fileKey, hashDiff, detectChangedFiles } from "../diff-utils.js";
import type { DiffFile, DiffSet } from "../types.js";

function makeFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: "src/index.ts",
    status: "modified",
    hunks: [],
    language: "typescript",
    binary: false,
    additions: 10,
    deletions: 5,
    ...overrides,
  };
}

function makeDiffSet(files: DiffFile[]): DiffSet {
  return { baseRef: "HEAD", headRef: "working-copy", files };
}

describe("fileKey", () => {
  it("returns plain path when no stage", () => {
    const file = makeFile({ path: "src/foo.ts" });
    expect(fileKey(file)).toBe("src/foo.ts");
  });

  it("returns staged prefix when stage is staged", () => {
    const file = makeFile({ path: "src/foo.ts", stage: "staged" });
    expect(fileKey(file)).toBe("staged:src/foo.ts");
  });

  it("returns unstaged prefix when stage is unstaged", () => {
    const file = makeFile({ path: "src/foo.ts", stage: "unstaged" });
    expect(fileKey(file)).toBe("unstaged:src/foo.ts");
  });
});

describe("hashDiff", () => {
  it("returns consistent hash for same input", () => {
    const hash1 = hashDiff("hello world");
    const hash2 = hashDiff("hello world");
    expect(hash1).toBe(hash2);
  });

  it("returns different hashes for different inputs", () => {
    const hash1 = hashDiff("hello world");
    const hash2 = hashDiff("goodbye world");
    expect(hash1).not.toBe(hash2);
  });

  it("returns a hex string", () => {
    const hash = hashDiff("test");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("detectChangedFiles", () => {
  it("returns all files when old is null", () => {
    const newSet = makeDiffSet([
      makeFile({ path: "a.ts" }),
      makeFile({ path: "b.ts" }),
    ]);

    const changed = detectChangedFiles(null, newSet);
    expect(changed).toEqual(["a.ts", "b.ts"]);
  });

  it("detects added files", () => {
    const oldSet = makeDiffSet([makeFile({ path: "a.ts" })]);
    const newSet = makeDiffSet([
      makeFile({ path: "a.ts" }),
      makeFile({ path: "b.ts" }),
    ]);

    const changed = detectChangedFiles(oldSet, newSet);
    expect(changed).toContain("b.ts");
    expect(changed).not.toContain("a.ts");
  });

  it("detects removed files", () => {
    const oldSet = makeDiffSet([
      makeFile({ path: "a.ts" }),
      makeFile({ path: "b.ts" }),
    ]);
    const newSet = makeDiffSet([makeFile({ path: "a.ts" })]);

    const changed = detectChangedFiles(oldSet, newSet);
    expect(changed).toContain("b.ts");
    expect(changed).not.toContain("a.ts");
  });

  it("detects modified files (additions changed)", () => {
    const oldSet = makeDiffSet([makeFile({ path: "a.ts", additions: 5 })]);
    const newSet = makeDiffSet([makeFile({ path: "a.ts", additions: 10 })]);

    const changed = detectChangedFiles(oldSet, newSet);
    expect(changed).toContain("a.ts");
  });

  it("detects modified files (deletions changed)", () => {
    const oldSet = makeDiffSet([makeFile({ path: "a.ts", deletions: 2 })]);
    const newSet = makeDiffSet([makeFile({ path: "a.ts", deletions: 8 })]);

    const changed = detectChangedFiles(oldSet, newSet);
    expect(changed).toContain("a.ts");
  });

  it("returns empty when nothing changed", () => {
    const oldSet = makeDiffSet([
      makeFile({ path: "a.ts", additions: 10, deletions: 5 }),
    ]);
    const newSet = makeDiffSet([
      makeFile({ path: "a.ts", additions: 10, deletions: 5 }),
    ]);

    const changed = detectChangedFiles(oldSet, newSet);
    expect(changed).toEqual([]);
  });

  it("handles staged files independently", () => {
    const oldSet = makeDiffSet([
      makeFile({ path: "a.ts", stage: "staged", additions: 5 }),
    ]);
    const newSet = makeDiffSet([
      makeFile({ path: "a.ts", stage: "staged", additions: 5 }),
      makeFile({ path: "a.ts", stage: "unstaged", additions: 3 }),
    ]);

    const changed = detectChangedFiles(oldSet, newSet);
    expect(changed).toContain("unstaged:a.ts");
    expect(changed).not.toContain("staged:a.ts");
  });
});
