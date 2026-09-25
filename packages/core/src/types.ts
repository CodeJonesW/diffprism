import type { ReviewAgentChoice } from "./agent-settings.js";
import type { DojoRunner, DojoState } from "./dojo.js";
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
  /** Which file `line` counts in — a deleted line is numbered in the old one (#175). */
  side: DiffSide;
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
  /**
   * The GitHub login DiffPrism posts reviews as, or null when its token has no
   * user. When it's the author, GitHub only accepts a comment: an author can't
   * approve or request changes on their own pull request (#191).
   */
  viewer: string | null;
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
  | { type: "annotation:updated"; payload: Annotation }
  | { type: "dojo:update"; payload: DojoState };

export type ClientMessage =
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
  /** The DiffPrism version the server runs. Absent for servers from before #214. */
  version?: string;
  /** The checkout a dev build runs from; absent for a release (or a server from before #214). */
  devRoot?: string;
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
  /**
   * Last time an agent — an MCP tool, or a CLI/hook caller blocked on the
   * decision — read this session's threads. Unset until one does. A reviewer
   * message newer than this hasn't reached any agent.
   */
  agentReadAt?: number;
}

export interface GlobalServerOptions {
  httpPort?: number; // default 24680
  wsPort?: number; // default 24681
  /**
   * Dashboard port, default 24682. Preferred like the others so the dashboard's
   * address survives a server restart: an open tab can reload into the new
   * server instead of a new tab opening beside a dead one.
   */
  uiPort?: number;
  /** How long after start to wait for an open dashboard to reconnect before opening a tab. */
  reconnectGraceMs?: number;
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
  /**
   * Starts the agent that answers a PR review's comments, whichever way the
   * review was opened (#224). The CLI supplies it; core knows nothing about
   * Claude Code. Without one, PR reviews get no agent.
   */
  prAgent?: PrAgentStarter;
  /**
   * Runs review dojos: several agents review a PR and vote on each other's
   * findings (#231). The CLI supplies it. Without one, a PR review has no dojo.
   */
  dojo?: DojoRunner;
}

/** What an agent needs to start answering a PR review. */
export interface PrAgentRequest {
  sessionId: string;
  prUrl: string;
  /** The local clone the review reads from, or null when there isn't one. */
  localRepoPath: string | null;
  /** The server the review is on — the agent reads and replies through it. */
  server: GlobalServerInfo;
  /** Which agent to start, and with which model (#226). */
  agent: ReviewAgentChoice;
}

/** An agent that has started answering a PR review. */
export interface PrAgentHandle {
  /** The agent and model answering. */
  agent: ReviewAgentChoice;
  /** How the agent signs its replies, e.g. "Claude Code". */
  label: string;
  /** Its conversation, which the reviewer can continue in a terminal. */
  conversationId: string;
  /** The folder it runs in. */
  cwd: string;
  /** The shell command that continues the conversation, from any folder. */
  resumeCommand: string;
  /** Settles when the agent stops, for whatever reason. Never rejects. */
  done: Promise<void>;
}

/**
 * Starts an agent for a PR review. Rejects with the reason when none can
 * start here — not installed, not logged in — so whoever opened the review
 * can be told. Asynchronous because starting can take a moment (Cursor checks
 * its login and opens a chat), and the server mustn't stop answering while it
 * does.
 */
export type PrAgentStarter = (request: PrAgentRequest) => Promise<PrAgentHandle>;

export interface GlobalServerHandle {
  httpPort: number;
  wsPort: number;
  stop: () => Promise<void>;
}
