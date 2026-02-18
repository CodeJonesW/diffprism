// ─── Diff Types ───
// Local copy of @diffprism/core types for Vite runtime use

export interface Change {
  type: "add" | "delete" | "context";
  lineNumber: number;
  content: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: Change[];
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
  hunks: Hunk[];
  language: string;
  binary: boolean;
  additions: number;
  deletions: number;
}

export interface DiffSet {
  baseRef: string;
  headRef: string;
  files: DiffFile[];
}

// ─── Review Types ───

export type ReviewDecision =
  | "approved"
  | "changes_requested"
  | "approved_with_comments";

export interface ReviewComment {
  file: string;
  line: number;
  body: string;
  type: "must_fix" | "suggestion" | "question" | "nitpick";
}

export interface ReviewResult {
  decision: ReviewDecision;
  comments: ReviewComment[];
  summary?: string;
}

// ─── Analysis / Briefing Types ───

export interface AnnotatedChange {
  file: string;
  description: string;
  reason: string;
}

export interface ReviewBriefing {
  summary: string;
  triage: {
    critical: AnnotatedChange[];
    notable: AnnotatedChange[];
    mechanical: AnnotatedChange[];
  };
  impact: {
    affectedModules: string[];
    affectedTests: string[];
    publicApiChanges: boolean;
    breakingChanges: string[];
    newDependencies: string[];
  };
  verification: {
    testsPass: boolean | null;
    typeCheck: boolean | null;
    lintClean: boolean | null;
  };
  fileStats: Array<{
    path: string;
    language: string;
    status: DiffFile["status"];
    additions: number;
    deletions: number;
  }>;
}

// ─── WebSocket Protocol ───

export interface ReviewInitPayload {
  reviewId: string;
  diffSet: DiffSet;
  rawDiff: string;
  briefing: ReviewBriefing;
  metadata: ReviewMetadata;
}

export interface ReviewMetadata {
  title?: string;
  description?: string;
  reasoning?: string;
}

export type ServerMessage = {
  type: "review:init";
  payload: ReviewInitPayload;
};

export type ClientMessage = {
  type: "review:submit";
  payload: ReviewResult;
};
