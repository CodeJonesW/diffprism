import type { DiffSet, ReviewBriefing } from "@diffprism/core";

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
} from "./deterministic.js";

export {
  categorizeFiles,
  computeFileStats,
  detectAffectedModules,
  detectAffectedTests,
  detectNewDependencies,
  generateSummary,
  computeComplexityScores,
  detectTestCoverageGaps,
  detectPatterns,
} from "./deterministic.js";

/**
 * Produce a ReviewBriefing from a DiffSet using deterministic analysis only.
 */
export function analyze(diffSet: DiffSet): ReviewBriefing {
  const { files } = diffSet;

  const triage = categorizeFiles(files);
  const fileStats = computeFileStats(files);
  const affectedModules = detectAffectedModules(files);
  const affectedTests = detectAffectedTests(files);
  const newDependencies = detectNewDependencies(files);
  const summary = generateSummary(files);
  const complexity = computeComplexityScores(files);
  const testCoverage = detectTestCoverageGaps(files);
  const patterns = detectPatterns(files);

  return {
    summary,
    triage,
    impact: {
      affectedModules,
      affectedTests,
      publicApiChanges: false,
      breakingChanges: [],
      newDependencies,
    },
    verification: {
      testsPass: null,
      typeCheck: null,
      lintClean: null,
    },
    fileStats,
    complexity,
    testCoverage,
    patterns,
  };
}
