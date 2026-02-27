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
  stage?: "staged" | "unstaged";
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
  | "approved_with_comments"
  | "dismissed";

export type FileReviewStatus =
  | "unreviewed"
  | "reviewed"
  | "approved"
  | "needs_changes";

export interface ReviewComment {
  file: string;
  line: number;
  body: string;
  type: "must_fix" | "suggestion" | "question" | "nitpick";
}

export type PostReviewAction = "commit" | "commit_and_pr";

export interface ReviewResult {
  decision: ReviewDecision;
  comments: ReviewComment[];
  fileStatuses?: Record<string, FileReviewStatus>;
  summary?: string;
  postReviewAction?: PostReviewAction;
  postToGithub?: boolean;
}

// ─── Annotation Types ───

export type AnnotationType = "finding" | "suggestion" | "question" | "warning";

export type AnnotationCategory =
  | "security"
  | "performance"
  | "convention"
  | "correctness"
  | "complexity"
  | "test-coverage"
  | "documentation"
  | "other";

export interface AnnotationSource {
  agent: string; // agent identifier (e.g., "security-reviewer", "convention-checker")
  tool?: string; // MCP tool that created it (e.g., "add_annotation")
}

export interface Annotation {
  id: string;
  sessionId: string;
  file: string;
  line: number;
  body: string;
  type: AnnotationType;
  confidence: number; // 0-1
  category: AnnotationCategory;
  source: AnnotationSource;
  createdAt: number; // Unix timestamp ms
  dismissed?: boolean;
}

export interface SessionState {
  sessionId: string;
  status: GlobalSessionStatus;
  files: Array<{
    path: string;
    reviewStatus: FileReviewStatus;
  }>;
  comments: ReviewComment[];
  annotations: Annotation[];
  decision?: ReviewDecision;
}

// ─── Analysis / Briefing Types ───

export interface AnnotatedChange {
  file: string;
  description: string;
  reason: string;
}

export interface ComplexityScore {
  path: string;
  score: number;
  factors: string[];
}

export interface TestCoverageGap {
  sourceFile: string;
  testFile: string | null;
}

export type SecuritySeverity = "critical" | "warning";

export interface PatternFlag {
  file: string;
  line: number;
  pattern:
    | "todo"
    | "fixme"
    | "hack"
    | "console"
    | "debug"
    | "disabled_test"
    | "large_file"
    | "eval"
    | "inner_html"
    | "sql_injection"
    | "exec"
    | "hardcoded_secret"
    | "insecure_url";
  content: string;
  severity?: SecuritySeverity;
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
  complexity?: ComplexityScore[];
  testCoverage?: TestCoverageGap[];
  patterns?: PatternFlag[];
}

// ─── WebSocket Protocol ───

export interface ReviewInitPayload {
  reviewId: string;
  diffSet: DiffSet;
  rawDiff: string;
  briefing: ReviewBriefing;
  metadata: ReviewMetadata;
  watchMode?: boolean;
}

export interface WorktreeMetadata {
  isWorktree: boolean;
  worktreePath?: string;
  mainWorktreePath?: string;
}

export interface GitHubPrMetadata {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  baseBranch: string;
  headBranch: string;
}

export interface ReviewMetadata {
  title?: string;
  description?: string;
  reasoning?: string;
  currentBranch?: string;
  worktree?: WorktreeMetadata;
  githubPr?: GitHubPrMetadata;
}

export interface DiffUpdatePayload {
  diffSet: DiffSet;
  rawDiff: string;
  briefing: ReviewBriefing;
  changedFiles: string[];
  timestamp: number;
}

export interface ContextUpdatePayload {
  reasoning?: string;
  title?: string;
  description?: string;
}

// ─── Git Refs Types ───

export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string; // ISO 8601
}

export interface BranchList {
  local: string[];
  remote: string[];
}

export interface GitRefsPayload {
  branches: BranchList;
  commits: CommitInfo[];
  currentBranch: string;
}

export type GlobalSessionStatus = "pending" | "in_review" | "submitted";

export interface SessionSummary {
  id: string;
  projectPath: string;
  branch?: string;
  title?: string;
  fileCount: number;
  additions: number;
  deletions: number;
  status: GlobalSessionStatus;
  decision?: ReviewDecision;
  createdAt: number;
  hasNewChanges?: boolean;
}

export interface DiffErrorPayload {
  error: string;
}

export type ServerMessage =
  | { type: "review:init"; payload: ReviewInitPayload }
  | { type: "diff:update"; payload: DiffUpdatePayload }
  | { type: "diff:error"; payload: DiffErrorPayload }
  | { type: "context:update"; payload: ContextUpdatePayload }
  | { type: "session:list"; payload: SessionSummary[] }
  | { type: "session:added"; payload: SessionSummary }
  | { type: "session:updated"; payload: SessionSummary }
  | { type: "session:removed"; payload: { sessionId: string } }
  | { type: "annotation:added"; payload: Annotation }
  | { type: "annotation:dismissed"; payload: { annotationId: string } };

export type ClientMessage =
  | { type: "review:submit"; payload: ReviewResult }
  | { type: "diff:change_ref"; payload: { diffRef: string } }
  | { type: "session:select"; payload: { sessionId: string } }
  | { type: "session:close"; payload: { sessionId: string } };
