import type {
  DiffFile,
  AnnotatedChange,
  ComplexityScore,
  TestCoverageGap,
  PatternFlag,
  SecuritySeverity,
} from "@diffprism/core";

// ─── File Categorization ───

export interface FileTriage {
  critical: AnnotatedChange[];
  notable: AnnotatedChange[];
  mechanical: AnnotatedChange[];
}

// Config file patterns for mechanical categorization
const MECHANICAL_CONFIG_PATTERNS = [
  /\.config\./,
  /\.eslintrc/,
  /\.prettierrc/,
  /tsconfig.*\.json$/,
  /\.gitignore$/,
  /\.lock$/,
];

// API surface path patterns
const API_SURFACE_PATTERNS = [
  /\/api\//,
  /\/routes\//,
];

/**
 * Check whether all changed lines in a file differ only by whitespace.
 */
function isFormattingOnly(file: DiffFile): boolean {
  if (file.hunks.length === 0) return false;

  for (const hunk of file.hunks) {
    // For each hunk, check that all additions and deletions pair up exactly
    // when whitespace is stripped. This detects formatting-only changes.
    const adds = hunk.changes
      .filter((c) => c.type === "add")
      .map((c) => c.content.replace(/\s/g, ""));
    const deletes = hunk.changes
      .filter((c) => c.type === "delete")
      .map((c) => c.content.replace(/\s/g, ""));

    // If there are only adds with no deletes (or vice versa), it's not formatting-only
    if (adds.length === 0 || deletes.length === 0) return false;

    // Every add should have a matching delete (whitespace-normalized)
    const deleteBag = [...deletes];
    for (const add of adds) {
      const idx = deleteBag.indexOf(add);
      if (idx === -1) return false;
      deleteBag.splice(idx, 1);
    }
    // All deletes should be consumed
    if (deleteBag.length > 0) return false;
  }

  return true;
}

/**
 * Check whether all added/deleted lines are import or require statements.
 */
function isImportOnly(file: DiffFile): boolean {
  if (file.hunks.length === 0) return false;

  const importPattern = /^\s*(import\s|export\s.*from\s|const\s+\w+\s*=\s*require\(|require\()/;

  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === "context") continue;
      const trimmed = change.content.trim();
      // Skip empty lines
      if (trimmed === "") continue;
      if (!importPattern.test(trimmed)) return false;
    }
  }

  return true;
}

/**
 * Check whether a file path matches common config file patterns.
 */
function isMechanicalConfigFile(path: string): boolean {
  return MECHANICAL_CONFIG_PATTERNS.some((re) => re.test(path));
}

/**
 * Check whether a file looks like a public API surface with significant additions.
 */
function isApiSurface(file: DiffFile): boolean {
  // Path-based: contains api/ or routes/
  if (API_SURFACE_PATTERNS.some((re) => re.test(file.path))) return true;

  // index.ts/index.js with many additions (re-export barrel or entry point)
  const basename = file.path.slice(file.path.lastIndexOf("/") + 1);
  if ((basename === "index.ts" || basename === "index.js") && file.additions >= 10) {
    return true;
  }

  return false;
}

/**
 * Categorize files into critical / notable / mechanical buckets.
 *
 * Critical: security patterns, high complexity (>= 8), or public API surface.
 * Mechanical: pure renames, formatting-only, config files, import-only changes.
 * Notable: everything else.
 */
export function categorizeFiles(files: DiffFile[]): FileTriage {
  const critical: AnnotatedChange[] = [];
  const notable: AnnotatedChange[] = [];
  const mechanical: AnnotatedChange[] = [];

  // Pre-compute security patterns and complexity scores for all files
  const securityFlags = detectSecurityPatterns(files);
  const complexityScores = computeComplexityScores(files);

  // Build lookup maps
  const securityByFile = new Map<string, PatternFlag[]>();
  for (const flag of securityFlags) {
    const existing = securityByFile.get(flag.file) || [];
    existing.push(flag);
    securityByFile.set(flag.file, existing);
  }

  const complexityByFile = new Map<string, ComplexityScore>();
  for (const score of complexityScores) {
    complexityByFile.set(score.path, score);
  }

  for (const file of files) {
    const description = `${file.status} (${file.language || "unknown"}) +${file.additions} -${file.deletions}`;
    const fileSecurityFlags = securityByFile.get(file.path);
    const fileComplexity = complexityByFile.get(file.path);

    // ── Critical checks ──
    const criticalReasons: string[] = [];

    if (fileSecurityFlags && fileSecurityFlags.length > 0) {
      const patterns = fileSecurityFlags.map((f) => f.pattern);
      const unique = [...new Set(patterns)];
      criticalReasons.push(`security patterns detected: ${unique.join(", ")}`);
    }

    if (fileComplexity && fileComplexity.score >= 8) {
      criticalReasons.push(`high complexity score (${fileComplexity.score}/10)`);
    }

    if (isApiSurface(file)) {
      criticalReasons.push("modifies public API surface");
    }

    if (criticalReasons.length > 0) {
      critical.push({
        file: file.path,
        description,
        reason: `Critical: ${criticalReasons.join("; ")}`,
      });
      continue;
    }

    // ── Mechanical checks ──
    const isPureRename =
      file.status === "renamed" && file.additions === 0 && file.deletions === 0;

    if (isPureRename) {
      mechanical.push({
        file: file.path,
        description,
        reason: "Mechanical: pure rename with no content changes",
      });
      continue;
    }

    if (isFormattingOnly(file)) {
      mechanical.push({
        file: file.path,
        description,
        reason: "Mechanical: formatting/whitespace-only changes",
      });
      continue;
    }

    if (isMechanicalConfigFile(file.path)) {
      mechanical.push({
        file: file.path,
        description,
        reason: "Mechanical: config file change",
      });
      continue;
    }

    if (file.hunks.length > 0 && isImportOnly(file)) {
      mechanical.push({
        file: file.path,
        description,
        reason: "Mechanical: import/require-only changes",
      });
      continue;
    }

    // ── Notable (default) ──
    notable.push({
      file: file.path,
      description,
      reason: "Notable: requires review",
    });
  }

  return { critical, notable, mechanical };
}

// ─── File Stats ───

export interface FileStat {
  path: string;
  language: string;
  status: DiffFile["status"];
  additions: number;
  deletions: number;
}

/**
 * Extract per-file statistics from the diff.
 */
export function computeFileStats(files: DiffFile[]): FileStat[] {
  return files.map((f) => ({
    path: f.path,
    language: f.language,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
  }));
}

// ─── Affected Modules ───

/**
 * Derive unique directory paths (module boundaries) from the changed files.
 */
export function detectAffectedModules(files: DiffFile[]): string[] {
  const dirs = new Set<string>();

  for (const f of files) {
    const lastSlash = f.path.lastIndexOf("/");
    if (lastSlash > 0) {
      dirs.add(f.path.slice(0, lastSlash));
    }
  }

  return [...dirs].sort();
}

// ─── Affected Tests ───

const TEST_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\/__tests__\//,
  /\/test\//,
];

/**
 * Identify files that match common test-file patterns.
 */
export function detectAffectedTests(files: DiffFile[]): string[] {
  return files
    .filter((f) => TEST_PATTERNS.some((re) => re.test(f.path)))
    .map((f) => f.path);
}

// ─── New Dependencies ───

const DEPENDENCY_FIELDS = [
  '"dependencies"',
  '"devDependencies"',
  '"peerDependencies"',
  '"optionalDependencies"',
];

/**
 * Scan package.json additions for lines that look like new dependency entries.
 * Returns an array of dependency names found in added lines.
 */
export function detectNewDependencies(files: DiffFile[]): string[] {
  const deps = new Set<string>();

  const packageFiles = files.filter(
    (f) => f.path.endsWith("package.json") && f.hunks.length > 0,
  );

  for (const file of packageFiles) {
    for (const hunk of file.hunks) {
      let inDependencyBlock = false;

      for (const change of hunk.changes) {
        const line = change.content;

        // Track whether we are inside a dependency field block.
        if (DEPENDENCY_FIELDS.some((field) => line.includes(field))) {
          inDependencyBlock = true;
          continue;
        }

        // A closing brace ends the current dependency block.
        if (inDependencyBlock && line.trim().startsWith("}")) {
          inDependencyBlock = false;
          continue;
        }

        // Only look at added lines inside a dependency block.
        if (change.type === "add" && inDependencyBlock) {
          // Match lines like: "some-package": "^1.0.0"
          const match = line.match(/"([^"]+)"\s*:/);
          if (match) {
            deps.add(match[1]);
          }
        }
      }
    }
  }

  return [...deps].sort();
}

// ─── Summary ───

/**
 * Produce a human-readable one-line summary of the diff.
 */
export function generateSummary(files: DiffFile[]): string {
  const totalFiles = files.length;

  const counts: Record<DiffFile["status"], number> = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
  };

  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const f of files) {
    counts[f.status]++;
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  const parts: string[] = [];
  if (counts.modified > 0) parts.push(`${counts.modified} modified`);
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.deleted > 0) parts.push(`${counts.deleted} deleted`);
  if (counts.renamed > 0) parts.push(`${counts.renamed} renamed`);

  const breakdown = parts.length > 0 ? `: ${parts.join(", ")}` : "";

  return `${totalFiles} files changed${breakdown} (+${totalAdditions} -${totalDeletions})`;
}

// ─── Complexity Scoring ───

const BRANCH_PATTERN =
  /\b(if|else|switch|case|catch)\b|\?\s|&&|\|\|/;

/**
 * Compute a 1-10 complexity score per file based on diff size,
 * hunk count, logic branches, and nesting depth.
 */
export function computeComplexityScores(files: DiffFile[]): ComplexityScore[] {
  const results: ComplexityScore[] = [];

  for (const file of files) {
    let score = 0;
    const factors: string[] = [];
    const totalChanges = file.additions + file.deletions;

    // Diff size
    if (totalChanges > 100) {
      score += 3;
      factors.push(`large diff (+${file.additions} -${file.deletions})`);
    } else if (totalChanges > 50) {
      score += 2;
      factors.push(`medium diff (+${file.additions} -${file.deletions})`);
    } else if (totalChanges > 20) {
      score += 1;
      factors.push(`moderate diff (+${file.additions} -${file.deletions})`);
    }

    // Hunk count
    const hunkCount = file.hunks.length;
    if (hunkCount > 4) {
      score += 2;
      factors.push(`many hunks (${hunkCount})`);
    } else if (hunkCount > 2) {
      score += 1;
      factors.push(`multiple hunks (${hunkCount})`);
    }

    // Logic branches in added lines
    let branchCount = 0;
    let deepNestCount = 0;

    for (const hunk of file.hunks) {
      for (const change of hunk.changes) {
        if (change.type !== "add") continue;
        const line = change.content;

        if (BRANCH_PATTERN.test(line)) {
          branchCount++;
        }

        // Deep indentation: 4+ tabs or 16+ leading spaces
        const leadingSpaces = line.match(/^(\s*)/);
        if (leadingSpaces) {
          const ws = leadingSpaces[1];
          const tabCount = (ws.match(/\t/g) || []).length;
          const spaceCount = ws.replace(/\t/g, "").length;
          if (tabCount >= 4 || spaceCount >= 16) {
            deepNestCount++;
          }
        }
      }
    }

    const branchScore = Math.floor(branchCount / 5);
    if (branchScore > 0) {
      score += branchScore;
      factors.push(`${branchCount} logic branches`);
    }

    const nestScore = Math.floor(deepNestCount / 5);
    if (nestScore > 0) {
      score += nestScore;
      factors.push(`${deepNestCount} deeply nested lines`);
    }

    // Clamp to 1-10
    score = Math.max(1, Math.min(10, score));

    results.push({ path: file.path, score, factors });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

// ─── Test Coverage Gap Detection ───

const NON_CODE_EXTENSIONS = new Set([
  ".json",
  ".md",
  ".css",
  ".scss",
  ".less",
  ".svg",
  ".png",
  ".jpg",
  ".gif",
  ".ico",
  ".yaml",
  ".yml",
  ".toml",
  ".lock",
  ".html",
]);

const CONFIG_PATTERNS = [
  /\.config\./,
  /\.rc\./,
  /eslint/,
  /prettier/,
  /tsconfig/,
  /tailwind/,
  /vite\.config/,
  /vitest\.config/,
];

function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

function isNonCodeFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf("."));
  return NON_CODE_EXTENSIONS.has(ext);
}

function isConfigFile(path: string): boolean {
  return CONFIG_PATTERNS.some((re) => re.test(path));
}

/**
 * For each non-test source file that was added or modified,
 * check if a corresponding test file is also in the diff.
 */
export function detectTestCoverageGaps(files: DiffFile[]): TestCoverageGap[] {
  const filePaths = new Set(files.map((f) => f.path));
  const results: TestCoverageGap[] = [];

  for (const file of files) {
    // Only check added/modified source files
    if (file.status !== "added" && file.status !== "modified") continue;
    if (isTestFile(file.path)) continue;
    if (isNonCodeFile(file.path)) continue;
    if (isConfigFile(file.path)) continue;

    // Generate possible test file paths
    const dir = file.path.slice(0, file.path.lastIndexOf("/") + 1);
    const basename = file.path.slice(file.path.lastIndexOf("/") + 1);
    const extDot = basename.lastIndexOf(".");
    const name = extDot > 0 ? basename.slice(0, extDot) : basename;
    const ext = extDot > 0 ? basename.slice(extDot) : "";

    const candidates = [
      `${dir}${name}.test${ext}`,
      `${dir}${name}.spec${ext}`,
      `${dir}__tests__/${name}${ext}`,
      `${dir}__tests__/${name}.test${ext}`,
      `${dir}__tests__/${name}.spec${ext}`,
    ];

    const matchedTest = candidates.find((c) => filePaths.has(c));
    results.push({
      sourceFile: file.path,
      testFile: matchedTest ?? null,
    });
  }

  return results;
}

// ─── Pattern Detection ───

type PatternType = PatternFlag["pattern"];

interface PatternMatcher {
  pattern: PatternType;
  test: (line: string) => boolean;
}

const PATTERN_MATCHERS: PatternMatcher[] = [
  { pattern: "todo", test: (l) => /\btodo\b/i.test(l) },
  { pattern: "fixme", test: (l) => /\bfixme\b/i.test(l) },
  { pattern: "hack", test: (l) => /\bhack\b/i.test(l) },
  {
    pattern: "console",
    test: (l) => /\bconsole\.(log|debug|warn|error)\b/.test(l),
  },
  { pattern: "debug", test: (l) => /\bdebugger\b/.test(l) },
  {
    pattern: "disabled_test",
    test: (l) => /\.(skip)\(|(\bxit|xdescribe|xtest)\(/.test(l),
  },
];

/**
 * Scan added lines for patterns like TODO, console.log, disabled tests, etc.
 */
export function detectPatterns(files: DiffFile[]): PatternFlag[] {
  const results: PatternFlag[] = [];

  for (const file of files) {
    // Large generated file detection
    if (file.status === "added" && file.additions > 500) {
      results.push({
        file: file.path,
        line: 0,
        pattern: "large_file",
        content: `Large added file: ${file.additions} lines`,
      });
    }

    for (const hunk of file.hunks) {
      for (const change of hunk.changes) {
        if (change.type !== "add") continue;

        for (const matcher of PATTERN_MATCHERS) {
          if (matcher.test(change.content)) {
            results.push({
              file: file.path,
              line: change.lineNumber,
              pattern: matcher.pattern,
              content: change.content.trim(),
            });
          }
        }
      }
    }
  }

  // Sort by file then line number
  results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return results;
}

// ─── Security Pattern Detection ───

type SecurityPatternType = PatternFlag["pattern"];

interface SecurityPatternMatcher {
  pattern: SecurityPatternType;
  severity: SecuritySeverity;
  test: (line: string) => boolean;
}

const SECURITY_MATCHERS: SecurityPatternMatcher[] = [
  {
    pattern: "eval",
    severity: "critical",
    test: (l) => /\beval\s*\(/.test(l),
  },
  {
    pattern: "inner_html",
    severity: "warning",
    test: (l) => /\.innerHTML\b|dangerouslySetInnerHTML/.test(l),
  },
  {
    pattern: "sql_injection",
    severity: "critical",
    test: (l) =>
      /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(l) ||
      /\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/i.test(l),
  },
  {
    pattern: "exec",
    severity: "critical",
    test: (l) =>
      /child_process/.test(l) ||
      /\bexec\s*\(/.test(l) ||
      /\bexecSync\s*\(/.test(l),
  },
  {
    pattern: "hardcoded_secret",
    severity: "critical",
    test: (l) =>
      /\b(token|secret|api_key|apikey|password|passwd|credential)\s*=\s*["']/i.test(l),
  },
  {
    pattern: "insecure_url",
    severity: "warning",
    test: (l) => /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(l),
  },
];

/**
 * Scan added lines for security-sensitive patterns like eval(), innerHTML,
 * SQL injection, exec, hardcoded secrets, and insecure URLs.
 */
export function detectSecurityPatterns(files: DiffFile[]): PatternFlag[] {
  const results: PatternFlag[] = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const change of hunk.changes) {
        if (change.type !== "add") continue;

        for (const matcher of SECURITY_MATCHERS) {
          if (matcher.test(change.content)) {
            results.push({
              file: file.path,
              line: change.lineNumber,
              pattern: matcher.pattern,
              content: change.content.trim(),
              severity: matcher.severity,
            });
          }
        }
      }
    }
  }

  // Sort by severity (critical first) then file then line
  results.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1 };
    const aSev = severityOrder[a.severity!];
    const bSev = severityOrder[b.severity!];
    if (aSev !== bSev) return aSev - bSev;
    return a.file.localeCompare(b.file) || a.line - b.line;
  });

  return results;
}
