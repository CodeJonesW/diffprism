// ─── Diff Types ───

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
  | "approved_with_comments";

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

export interface ReviewResult {
  decision: ReviewDecision;
  comments: ReviewComment[];
  fileStatuses?: Record<string, FileReviewStatus>;
  summary?: string;
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

export interface ReviewMetadata {
  title?: string;
  description?: string;
  reasoning?: string;
  currentBranch?: string;
}

export type ServerMessage =
  | { type: "review:init"; payload: ReviewInitPayload }
  | { type: "diff:update"; payload: DiffUpdatePayload }
  | { type: "context:update"; payload: ContextUpdatePayload }
  | { type: "session:list"; payload: SessionSummary[] }
  | { type: "session:added"; payload: SessionSummary }
  | { type: "session:updated"; payload: SessionSummary }
  | { type: "session:removed"; payload: { sessionId: string } };

export type ClientMessage =
  | { type: "review:submit"; payload: ReviewResult }
  | { type: "session:select"; payload: { sessionId: string } }
  | { type: "session:close"; payload: { sessionId: string } };

// ─── Pipeline Options ───

export interface ReviewOptions {
  diffRef: string;
  title?: string;
  description?: string;
  reasoning?: string;
  cwd?: string;
  silent?: boolean; // suppress stdout (for MCP mode)
  dev?: boolean; // use Vite dev server instead of static files
}

// ─── Watch Mode ───

export interface WatchOptions {
  diffRef: string;
  title?: string;
  description?: string;
  reasoning?: string;
  cwd?: string;
  silent?: boolean;
  dev?: boolean;
  pollInterval?: number; // ms, default 1000
}

export interface DiffUpdatePayload {
  diffSet: DiffSet;
  rawDiff: string;
  briefing: ReviewBriefing;
  changedFiles: string[]; // files whose content changed since last update
  timestamp: number;
}

export interface ContextUpdatePayload {
  reasoning?: string;
  title?: string;
  description?: string;
}

export interface WatchHandle {
  stop: () => Promise<void>;
  updateContext: (payload: ContextUpdatePayload) => void;
}

export interface WatchFileInfo {
  wsPort: number;
  uiPort: number;
  pid: number;
  cwd: string;
  diffRef: string;
  startedAt: number;
}

export interface ReviewResultFile {
  result: ReviewResult;
  timestamp: number;
  consumed: boolean;
}

// ─── Global Server Types ───

export interface GlobalServerInfo {
  httpPort: number;
  wsPort: number;
  pid: number;
  startedAt: number;
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

export interface GlobalServerOptions {
  httpPort?: number; // default 24680
  wsPort?: number; // default 24681
  silent?: boolean;
  dev?: boolean;
  pollInterval?: number; // ms, default 2000
}

export interface GlobalServerHandle {
  httpPort: number;
  wsPort: number;
  stop: () => Promise<void>;
}
