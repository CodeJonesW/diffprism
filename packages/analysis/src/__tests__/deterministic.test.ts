import { describe, it, expect } from "vitest";
import type { DiffFile, DiffSet } from "@diffprism/core";
import { analyze } from "../index.js";
import {
  categorizeFiles,
  computeFileStats,
  detectAffectedModules,
  detectAffectedTests,
  detectNewDependencies,
  generateSummary,
} from "../deterministic.js";

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
  return { baseRef: "HEAD", headRef: "staged", files };
}

describe("categorizeFiles", () => {
  it("puts all files in notable for M0", () => {
    const files = [makeFile(), makeFile({ path: "src/utils.ts" })];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(0);
    expect(result.mechanical).toHaveLength(0);
    expect(result.notable).toHaveLength(2);
    expect(result.notable[0].file).toBe("src/index.ts");
  });

  it("handles empty file list", () => {
    const result = categorizeFiles([]);
    expect(result.notable).toHaveLength(0);
  });
});

describe("computeFileStats", () => {
  it("maps files to stats", () => {
    const files = [
      makeFile({ additions: 20, deletions: 3 }),
      makeFile({ path: "lib/helper.py", language: "python", additions: 5, deletions: 0 }),
    ];
    const stats = computeFileStats(files);

    expect(stats).toHaveLength(2);
    expect(stats[0]).toEqual({
      path: "src/index.ts",
      language: "typescript",
      status: "modified",
      additions: 20,
      deletions: 3,
    });
    expect(stats[1].language).toBe("python");
  });
});

describe("detectAffectedModules", () => {
  it("extracts unique directories", () => {
    const files = [
      makeFile({ path: "src/components/App.tsx" }),
      makeFile({ path: "src/components/Button.tsx" }),
      makeFile({ path: "src/utils/helpers.ts" }),
      makeFile({ path: "README.md" }),
    ];
    const modules = detectAffectedModules(files);

    expect(modules).toEqual(["src/components", "src/utils"]);
  });

  it("skips root-level files", () => {
    const files = [makeFile({ path: "index.ts" })];
    expect(detectAffectedModules(files)).toEqual([]);
  });
});

describe("detectAffectedTests", () => {
  it("finds test files by pattern", () => {
    const files = [
      makeFile({ path: "src/index.ts" }),
      makeFile({ path: "src/index.test.ts" }),
      makeFile({ path: "src/utils.spec.ts" }),
      makeFile({ path: "src/__tests__/helper.ts" }),
      makeFile({ path: "test/e2e.ts" }),
    ];
    const tests = detectAffectedTests(files);

    // "test/e2e.ts" doesn't match /\/test\// (needs leading slash)
    expect(tests).toHaveLength(3);
    expect(tests).not.toContain("src/index.ts");
  });
});

describe("detectNewDependencies", () => {
  it("finds added deps in package.json hunks", () => {
    const files = [
      makeFile({
        path: "package.json",
        hunks: [
          {
            oldStart: 5,
            oldLines: 3,
            newStart: 5,
            newLines: 5,
            changes: [
              { type: "context", lineNumber: 5, content: '  "dependencies": {' },
              { type: "context", lineNumber: 6, content: '    "react": "^19.0.0",' },
              { type: "add", lineNumber: 7, content: '    "zustand": "^5.0.0",' },
              { type: "add", lineNumber: 8, content: '    "lucide-react": "^0.469.0",' },
              { type: "context", lineNumber: 9, content: "  }" },
            ],
          },
        ],
      }),
    ];
    const deps = detectNewDependencies(files);

    expect(deps).toEqual(["lucide-react", "zustand"]);
  });

  it("returns empty for non-package.json files", () => {
    const files = [makeFile({ path: "src/index.ts" })];
    expect(detectNewDependencies(files)).toEqual([]);
  });
});

describe("generateSummary", () => {
  it("produces a human-readable summary", () => {
    const files = [
      makeFile({ status: "modified", additions: 10, deletions: 5 }),
      makeFile({ path: "new.ts", status: "added", additions: 20, deletions: 0 }),
      makeFile({ path: "old.ts", status: "deleted", additions: 0, deletions: 15 }),
    ];
    const summary = generateSummary(files);

    expect(summary).toBe("3 files changed: 1 modified, 1 added, 1 deleted (+30 -20)");
  });

  it("handles empty file list", () => {
    expect(generateSummary([])).toBe("0 files changed (+0 -0)");
  });
});

describe("analyze", () => {
  it("produces a complete ReviewBriefing", () => {
    const diffSet = makeDiffSet([
      makeFile({ path: "src/index.ts", additions: 10, deletions: 2 }),
      makeFile({ path: "src/index.test.ts", status: "added", additions: 30, deletions: 0 }),
    ]);
    const briefing = analyze(diffSet);

    expect(briefing.summary).toContain("2 files changed");
    expect(briefing.triage.notable).toHaveLength(2);
    expect(briefing.impact.affectedModules).toEqual(["src"]);
    expect(briefing.impact.affectedTests).toEqual(["src/index.test.ts"]);
    expect(briefing.verification.testsPass).toBeNull();
    expect(briefing.fileStats).toHaveLength(2);
  });
});
