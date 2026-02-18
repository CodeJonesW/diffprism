import type { DiffFile, AnnotatedChange } from "@diffprism/core";

// ─── File Categorization ───

export interface FileTriage {
  critical: AnnotatedChange[];
  notable: AnnotatedChange[];
  mechanical: AnnotatedChange[];
}

/**
 * Categorize files into critical / notable / mechanical buckets.
 * M0: all files go into "notable"; critical and mechanical are empty.
 */
export function categorizeFiles(files: DiffFile[]): FileTriage {
  const notable: AnnotatedChange[] = files.map((f) => ({
    file: f.path,
    description: `${f.status} (${f.language || "unknown"}) +${f.additions} -${f.deletions}`,
    reason: "Uncategorized in M0 — placed in notable by default",
  }));

  return {
    critical: [],
    notable,
    mechanical: [],
  };
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
