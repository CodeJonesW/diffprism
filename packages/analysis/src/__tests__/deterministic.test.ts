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
  computeComplexityScores,
  detectTestCoverageGaps,
  detectPatterns,
  detectSecurityPatterns,
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
  it("handles empty file list", () => {
    const result = categorizeFiles([]);
    expect(result.critical).toHaveLength(0);
    expect(result.notable).toHaveLength(0);
    expect(result.mechanical).toHaveLength(0);
  });

  it("marks a file with security patterns as critical", () => {
    const files = [
      makeFile({
        path: "src/handler.ts",
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 1,
            changes: [
              { type: "add", lineNumber: 1, content: "  const result = eval(userInput);" },
            ],
          },
        ],
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].file).toBe("src/handler.ts");
    expect(result.critical[0].reason).toContain("security patterns");
    expect(result.critical[0].reason).toContain("eval");
    expect(result.notable).toHaveLength(0);
    expect(result.mechanical).toHaveLength(0);
  });

  it("marks a high-complexity file as critical", () => {
    // Create a file with enough complexity to score >= 8
    // Large diff (3) + many hunks (2) + many branches (2+) = 7+
    const hunks = Array.from({ length: 6 }, (_, i) => ({
      oldStart: i * 30,
      oldLines: 10,
      newStart: i * 30,
      newLines: 20,
      changes: Array.from({ length: 10 }, (_, j) => ({
        type: "add" as const,
        lineNumber: i * 30 + j + 1,
        content: "  if (x) { return y && z || w; }",
      })),
    }));

    const files = [
      makeFile({
        path: "src/complex.ts",
        additions: 200,
        deletions: 50,
        hunks,
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].file).toBe("src/complex.ts");
    expect(result.critical[0].reason).toContain("complexity");
    expect(result.notable).toHaveLength(0);
    expect(result.mechanical).toHaveLength(0);
  });

  it("marks API surface files as critical", () => {
    const files = [
      makeFile({
        path: "src/api/users.ts",
        additions: 5,
        deletions: 2,
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].reason).toContain("API surface");
  });

  it("marks routes files as critical", () => {
    const files = [
      makeFile({
        path: "src/routes/auth.ts",
        additions: 5,
        deletions: 2,
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].reason).toContain("API surface");
  });

  it("marks index.ts with many additions as critical (API surface)", () => {
    const files = [
      makeFile({
        path: "packages/core/src/index.ts",
        additions: 15,
        deletions: 2,
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].reason).toContain("API surface");
  });

  it("marks a pure rename as mechanical", () => {
    const files = [
      makeFile({
        path: "src/new-name.ts",
        oldPath: "src/old-name.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        hunks: [],
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.mechanical).toHaveLength(1);
    expect(result.mechanical[0].file).toBe("src/new-name.ts");
    expect(result.mechanical[0].reason).toContain("pure rename");
    expect(result.critical).toHaveLength(0);
    expect(result.notable).toHaveLength(0);
  });

  it("marks config files as mechanical", () => {
    const configs = [
      "vite.config.ts",
      ".eslintrc.json",
      ".prettierrc",
      "tsconfig.json",
      "tsconfig.build.json",
      ".gitignore",
      "pnpm-lock.lock",
    ];
    for (const configPath of configs) {
      const files = [
        makeFile({
          path: configPath,
          additions: 3,
          deletions: 1,
        }),
      ];
      const result = categorizeFiles(files);
      expect(result.mechanical).toHaveLength(1);
      expect(result.mechanical[0].reason).toContain("config file");
    }
  });

  it("marks formatting-only changes as mechanical", () => {
    const files = [
      makeFile({
        path: "src/utils.ts",
        additions: 2,
        deletions: 2,
        hunks: [
          {
            oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
            changes: [
              { type: "delete", lineNumber: 1, content: "const x=1;" },
              { type: "add", lineNumber: 1, content: "const x = 1;" },
              { type: "delete", lineNumber: 2, content: "const y=2;" },
              { type: "add", lineNumber: 2, content: "const y = 2;" },
            ],
          },
        ],
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.mechanical).toHaveLength(1);
    expect(result.mechanical[0].reason).toContain("formatting");
  });

  it("marks import-only changes as mechanical", () => {
    const files = [
      makeFile({
        path: "src/component.ts",
        additions: 1,
        deletions: 1,
        hunks: [
          {
            oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
            changes: [
              { type: "delete", lineNumber: 1, content: 'import { foo } from "./foo.js";' },
              { type: "add", lineNumber: 1, content: 'import { foo, bar } from "./foo.js";' },
            ],
          },
        ],
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.mechanical).toHaveLength(1);
    expect(result.mechanical[0].reason).toContain("import");
  });

  it("marks a normal source file as notable", () => {
    const files = [
      makeFile({
        path: "src/handler.ts",
        additions: 10,
        deletions: 5,
        hunks: [
          {
            oldStart: 1, oldLines: 5, newStart: 1, newLines: 10,
            changes: [
              { type: "add", lineNumber: 1, content: "  const result = computeValue();" },
              { type: "add", lineNumber: 2, content: "  return result;" },
            ],
          },
        ],
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.notable).toHaveLength(1);
    expect(result.notable[0].file).toBe("src/handler.ts");
    expect(result.notable[0].reason).toContain("Notable");
    expect(result.critical).toHaveLength(0);
    expect(result.mechanical).toHaveLength(0);
  });

  it("critical wins over mechanical (config file with security patterns)", () => {
    const files = [
      makeFile({
        path: "webpack.config.js",
        additions: 5,
        deletions: 2,
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 1,
            changes: [
              { type: "add", lineNumber: 1, content: '  const secret = "hardcoded_api_key_123";' },
            ],
          },
        ],
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].reason).toContain("security patterns");
    expect(result.mechanical).toHaveLength(0);
    expect(result.notable).toHaveLength(0);
  });

  it("combines multiple critical reasons", () => {
    // A file in api/ with security patterns
    const files = [
      makeFile({
        path: "src/api/auth.ts",
        additions: 5,
        deletions: 2,
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 1,
            changes: [
              { type: "add", lineNumber: 1, content: "  eval(userInput);" },
            ],
          },
        ],
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].reason).toContain("security patterns");
    expect(result.critical[0].reason).toContain("API surface");
  });

  it("correctly triages a mix of files", () => {
    const files = [
      // Critical: has eval
      makeFile({
        path: "src/dangerous.ts",
        additions: 5,
        deletions: 0,
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 1,
            changes: [
              { type: "add", lineNumber: 1, content: "  eval(code);" },
            ],
          },
        ],
      }),
      // Mechanical: config file
      makeFile({
        path: "tsconfig.json",
        additions: 1,
        deletions: 1,
      }),
      // Mechanical: pure rename
      makeFile({
        path: "src/renamed.ts",
        oldPath: "src/original.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        hunks: [],
      }),
      // Notable: normal file
      makeFile({
        path: "src/handler.ts",
        additions: 10,
        deletions: 3,
        hunks: [
          {
            oldStart: 1, oldLines: 3, newStart: 1, newLines: 10,
            changes: [
              { type: "add", lineNumber: 1, content: "  return processData();" },
            ],
          },
        ],
      }),
    ];
    const result = categorizeFiles(files);

    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].file).toBe("src/dangerous.ts");

    expect(result.mechanical).toHaveLength(2);
    expect(result.mechanical.map((m) => m.file).sort()).toEqual([
      "src/renamed.ts",
      "tsconfig.json",
    ]);

    expect(result.notable).toHaveLength(1);
    expect(result.notable[0].file).toBe("src/handler.ts");
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

describe("computeComplexityScores", () => {
  it("scores a small simple file low", () => {
    const files = [makeFile({ additions: 5, deletions: 2, hunks: [] })];
    const scores = computeComplexityScores(files);

    expect(scores).toHaveLength(1);
    expect(scores[0].score).toBe(1); // clamped minimum
    expect(scores[0].factors).toHaveLength(0);
  });

  it("scores a large multi-hunk file high", () => {
    const hunks = Array.from({ length: 5 }, (_, i) => ({
      oldStart: i * 20,
      oldLines: 10,
      newStart: i * 20,
      newLines: 15,
      changes: [
        { type: "add" as const, lineNumber: i * 20 + 1, content: "  if (x) {" },
        { type: "add" as const, lineNumber: i * 20 + 2, content: "    return y;" },
        { type: "add" as const, lineNumber: i * 20 + 3, content: "  } else {" },
        { type: "add" as const, lineNumber: i * 20 + 4, content: "    return z || w;" },
        { type: "add" as const, lineNumber: i * 20 + 5, content: "  }" },
      ],
    }));

    const files = [makeFile({ additions: 120, deletions: 30, hunks })];
    const scores = computeComplexityScores(files);

    expect(scores[0].score).toBeGreaterThanOrEqual(5);
    expect(scores[0].factors.length).toBeGreaterThan(0);
  });

  it("populates human-readable factors", () => {
    const files = [
      makeFile({
        additions: 60,
        deletions: 10,
        hunks: [
          {
            oldStart: 1, oldLines: 5, newStart: 1, newLines: 10,
            changes: [],
          },
          {
            oldStart: 20, oldLines: 5, newStart: 25, newLines: 10,
            changes: [],
          },
          {
            oldStart: 40, oldLines: 5, newStart: 50, newLines: 10,
            changes: [],
          },
        ],
      }),
    ];
    const scores = computeComplexityScores(files);

    expect(scores[0].factors.some((f) => f.includes("diff"))).toBe(true);
    expect(scores[0].factors.some((f) => f.includes("hunks"))).toBe(true);
  });

  it("sorts by score descending", () => {
    const files = [
      makeFile({ path: "small.ts", additions: 5, deletions: 0 }),
      makeFile({ path: "big.ts", additions: 150, deletions: 50 }),
    ];
    const scores = computeComplexityScores(files);

    expect(scores[0].path).toBe("big.ts");
    expect(scores[1].path).toBe("small.ts");
  });
});

describe("detectTestCoverageGaps", () => {
  it("returns testFile when source and test are both in diff", () => {
    const files = [
      makeFile({ path: "src/utils.ts", status: "modified" }),
      makeFile({ path: "src/utils.test.ts", status: "modified" }),
    ];
    const gaps = detectTestCoverageGaps(files);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].sourceFile).toBe("src/utils.ts");
    expect(gaps[0].testFile).toBe("src/utils.test.ts");
  });

  it("returns null testFile when no matching test in diff", () => {
    const files = [makeFile({ path: "src/handler.ts", status: "added" })];
    const gaps = detectTestCoverageGaps(files);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].sourceFile).toBe("src/handler.ts");
    expect(gaps[0].testFile).toBeNull();
  });

  it("matches __tests__ directory pattern", () => {
    const files = [
      makeFile({ path: "src/foo/bar.ts", status: "modified" }),
      makeFile({ path: "src/foo/__tests__/bar.ts", status: "modified" }),
    ];
    const gaps = detectTestCoverageGaps(files);

    expect(gaps[0].testFile).toBe("src/foo/__tests__/bar.ts");
  });

  it("excludes test-only files from results", () => {
    const files = [
      makeFile({ path: "src/foo.test.ts", status: "added" }),
      makeFile({ path: "src/__tests__/bar.ts", status: "added" }),
    ];
    const gaps = detectTestCoverageGaps(files);

    expect(gaps).toHaveLength(0);
  });

  it("excludes deleted files", () => {
    const files = [makeFile({ path: "src/old.ts", status: "deleted" })];
    const gaps = detectTestCoverageGaps(files);

    expect(gaps).toHaveLength(0);
  });

  it("excludes non-code files", () => {
    const files = [
      makeFile({ path: "README.md", status: "modified" }),
      makeFile({ path: "package.json", status: "modified" }),
      makeFile({ path: "styles.css", status: "added" }),
    ];
    const gaps = detectTestCoverageGaps(files);

    expect(gaps).toHaveLength(0);
  });
});

describe("detectPatterns", () => {
  it("detects TODO and FIXME in added lines", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 3,
            changes: [
              { type: "add", lineNumber: 1, content: "// TODO: implement this" },
              { type: "add", lineNumber: 2, content: "// FIXME: broken logic" },
              { type: "add", lineNumber: 3, content: "const x = 1;" },
            ],
          },
        ],
      }),
    ];
    const flags = detectPatterns(files);

    expect(flags.filter((f) => f.pattern === "todo")).toHaveLength(1);
    expect(flags.filter((f) => f.pattern === "fixme")).toHaveLength(1);
  });

  it("detects console.log statements", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 2,
            changes: [
              { type: "add", lineNumber: 1, content: '  console.log("debug");' },
              { type: "add", lineNumber: 2, content: '  console.error("err");' },
            ],
          },
        ],
      }),
    ];
    const flags = detectPatterns(files);

    expect(flags.filter((f) => f.pattern === "console")).toHaveLength(2);
  });

  it("detects disabled tests", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 2,
            changes: [
              { type: "add", lineNumber: 1, content: '  it.skip("should work", () => {' },
              { type: "add", lineNumber: 2, content: '  xdescribe("suite", () => {' },
            ],
          },
        ],
      }),
    ];
    const flags = detectPatterns(files);

    expect(flags.filter((f) => f.pattern === "disabled_test")).toHaveLength(2);
  });

  it("ignores patterns in deleted lines", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 2, newStart: 1, newLines: 0,
            changes: [
              { type: "delete", lineNumber: 1, content: "// TODO: old todo" },
              { type: "delete", lineNumber: 2, content: '  console.log("removed");' },
            ],
          },
        ],
      }),
    ];
    const flags = detectPatterns(files);

    expect(flags).toHaveLength(0);
  });

  it("detects large added files", () => {
    const files = [
      makeFile({ status: "added", additions: 600, hunks: [] }),
    ];
    const flags = detectPatterns(files);

    expect(flags).toHaveLength(1);
    expect(flags[0].pattern).toBe("large_file");
  });

  it("detects debugger statements", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 1,
            changes: [
              { type: "add", lineNumber: 5, content: "  debugger;" },
            ],
          },
        ],
      }),
    ];
    const flags = detectPatterns(files);

    expect(flags).toHaveLength(1);
    expect(flags[0].pattern).toBe("debug");
    expect(flags[0].line).toBe(5);
  });
});

describe("detectSecurityPatterns", () => {
  it("detects eval() calls", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 1,
            changes: [
              { type: "add", lineNumber: 1, content: "  const result = eval(userInput);" },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags).toHaveLength(1);
    expect(flags[0].pattern).toBe("eval");
    expect(flags[0].severity).toBe("critical");
  });

  it("detects innerHTML and dangerouslySetInnerHTML", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 2,
            changes: [
              { type: "add", lineNumber: 1, content: '  el.innerHTML = userInput;' },
              { type: "add", lineNumber: 2, content: '  <div dangerouslySetInnerHTML={{ __html: data }} />' },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags).toHaveLength(2);
    expect(flags.every((f) => f.pattern === "inner_html")).toBe(true);
    expect(flags.every((f) => f.severity === "warning")).toBe(true);
  });

  it("detects SQL injection in template literals", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 2,
            changes: [
              { type: "add", lineNumber: 1, content: "  const q = `SELECT * FROM users WHERE id = ${userId}`;" },
              { type: "add", lineNumber: 2, content: "  db.query(`INSERT INTO logs VALUES (${msg})`);" },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags).toHaveLength(2);
    expect(flags.every((f) => f.pattern === "sql_injection")).toBe(true);
    expect(flags.every((f) => f.severity === "critical")).toBe(true);
  });

  it("detects child_process.exec and execSync", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 2,
            changes: [
              { type: "add", lineNumber: 1, content: '  const { exec } = require("child_process");' },
              { type: "add", lineNumber: 2, content: "  execSync(command);" },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags.some((f) => f.pattern === "exec")).toBe(true);
    expect(flags.filter((f) => f.pattern === "exec").every((f) => f.severity === "critical")).toBe(true);
  });

  it("detects hardcoded secrets", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 3,
            changes: [
              { type: "add", lineNumber: 1, content: '  const token = "abc123secret";' },
              { type: "add", lineNumber: 2, content: "  const api_key = 'sk-1234';" },
              { type: "add", lineNumber: 3, content: '  const password = "hunter2";' },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags.filter((f) => f.pattern === "hardcoded_secret")).toHaveLength(3);
    expect(flags.every((f) => f.severity === "critical")).toBe(true);
  });

  it("detects insecure http:// URLs but allows localhost", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 3,
            changes: [
              { type: "add", lineNumber: 1, content: '  const api = "http://example.com/api";' },
              { type: "add", lineNumber: 2, content: '  const local = "http://localhost:3000";' },
              { type: "add", lineNumber: 3, content: '  const loopback = "http://127.0.0.1:8080";' },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags.filter((f) => f.pattern === "insecure_url")).toHaveLength(1);
    expect(flags[0].severity).toBe("warning");
    expect(flags[0].content).toContain("example.com");
  });

  it("ignores security patterns in deleted lines", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 2, newStart: 1, newLines: 0,
            changes: [
              { type: "delete", lineNumber: 1, content: "  eval(code);" },
              { type: "delete", lineNumber: 2, content: '  const secret = "abc123";' },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags).toHaveLength(0);
  });

  it("sorts critical before warning", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 2,
            changes: [
              { type: "add", lineNumber: 1, content: '  const api = "http://example.com";' },
              { type: "add", lineNumber: 2, content: "  eval(input);" },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags.length).toBeGreaterThanOrEqual(2);
    expect(flags[0].severity).toBe("critical");
    expect(flags[flags.length - 1].severity).toBe("warning");
  });

  it("returns empty for clean code", () => {
    const files = [
      makeFile({
        hunks: [
          {
            oldStart: 1, oldLines: 0, newStart: 1, newLines: 2,
            changes: [
              { type: "add", lineNumber: 1, content: '  const x = 1;' },
              { type: "add", lineNumber: 2, content: '  return x + 2;' },
            ],
          },
        ],
      }),
    ];
    const flags = detectSecurityPatterns(files);

    expect(flags).toHaveLength(0);
  });
});

describe("analyze", () => {
  it("produces a complete ReviewBriefing", () => {
    const diffSet = makeDiffSet([
      makeFile({ path: "src/handler.ts", additions: 10, deletions: 2 }),
      makeFile({ path: "src/handler.test.ts", status: "added", additions: 30, deletions: 0 }),
    ]);
    const briefing = analyze(diffSet);

    expect(briefing.summary).toContain("2 files changed");
    // Both files are notable: handler.ts is a normal source file, handler.test.ts is a test file
    expect(briefing.triage.notable).toHaveLength(2);
    expect(briefing.impact.affectedModules).toEqual(["src"]);
    expect(briefing.impact.affectedTests).toEqual(["src/handler.test.ts"]);
    expect(briefing.verification.testsPass).toBeNull();
    expect(briefing.fileStats).toHaveLength(2);

    // New analysis fields
    expect(briefing.complexity).toBeDefined();
    expect(briefing.complexity).toHaveLength(2);
    expect(briefing.testCoverage).toBeDefined();
    expect(briefing.testCoverage!.length).toBeGreaterThan(0);
    expect(briefing.patterns).toBeDefined();
    expect(Array.isArray(briefing.patterns)).toBe(true);
  });
});
