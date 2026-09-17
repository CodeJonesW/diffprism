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

/** Who wrote a message in a review thread. */
export type ThreadAuthor = "agent" | "reviewer";

export interface AnnotationReply {
  id: string;
  author: ThreadAuthor;
  /** Which agent, when an agent wrote it. */
  agent?: string;
  body: string;
  createdAt: number; // Unix timestamp ms
}

/**
 * A finding on a line, and the conversation under it. An agent can open one
 * (a finding) or the reviewer can (a question about the code); either side can
 * reply.
 */
/** Which file a diff line number counts in: the base ("old") or the change ("new"). */
export type DiffSide = "old" | "new";

/**
 * The reviewer's decision on a pull request, posted to GitHub as a review.
 * `threadIds` are the reviewer's own threads to include as inline comments —
 * threads are a conversation with the agent, so none is posted unless picked.
 */
export type PrReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface PrReviewSubmission {
  event: PrReviewEvent;
  summary?: string;
  threadIds?: string[];
}

export interface Annotation {
  id: string;
  sessionId: string;
  file: string;
  line: number;
  /** A deleted line is numbered in the old file; everything else in the new one. */
  side: DiffSide;
  body: string;
  type: AnnotationType;
  confidence: number; // 0-1
  category: AnnotationCategory;
  source: AnnotationSource;
  createdAt: number; // Unix timestamp ms
  dismissed?: boolean;
  /** Who opened the thread. Absent means an agent — every annotation from before threads was one. */
  author?: ThreadAuthor;
  replies?: AnnotationReply[];
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
  | { type: "annotation:dismissed"; payload: { annotationId: string } }
  | { type: "annotation:updated"; payload: Annotation };

export type ClientMessage =
  | { type: "review:submit"; payload: ReviewResult }
  | { type: "diff:change_ref"; payload: { diffRef: string } }
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
  injectedPayload?: ReviewInitPayload; // skip getDiff/analyze, use pre-computed payload (e.g. GitHub PR)
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

// ─── Global Server Types ───

export interface GlobalServerInfo {
  httpPort: number;
  wsPort: number;
  pid: number;
  startedAt: number;
  /** When the server's bundle was built. Absent for servers from before #181, or run from source. */
  builtAt?: number;
}

export type GlobalSessionStatus = "pending" | "in_review" | "submitted";

export type SessionSource = "manual" | "agent";

export interface SessionSummary {
  id: string;
  projectPath: string;
  branch?: string;
  title?: string;
  reasoning?: string;
  fileCount: number;
  additions: number;
  deletions: number;
  status: GlobalSessionStatus;
  decision?: ReviewDecision;
  createdAt: number;
  hasNewChanges?: boolean;
  needsAttention?: boolean;
  /** The diff ref this session currently shows, e.g. "working-copy" or "staged". */
  diffRef?: string;
  source?: SessionSource;
}

export interface GlobalServerOptions {
  httpPort?: number; // default 24680
  wsPort?: number; // default 24681
  silent?: boolean;
  dev?: boolean;
  pollInterval?: number; // ms, default 2000 — while a client is viewing the session
  /** ms before the first poll of a session nobody is viewing; default 30000. Backs off from here. */
  unviewedPollInterval?: number;
  /** ms ceiling for an unviewed session's back-off; default 300000. */
  unviewedPollMaxInterval?: number;
  /** ms a session can go unviewed, unwaited-on and unchanged before it expires; default 24h. */
  idleSessionTtl?: number;
  /** ms between expiry sweeps; default 60000. */
  cleanupInterval?: number;
  openBrowser?: boolean; // default true — set false for daemon auto-start
}

export interface GlobalServerHandle {
  httpPort: number;
  wsPort: number;
  stop: () => Promise<void>;
}
