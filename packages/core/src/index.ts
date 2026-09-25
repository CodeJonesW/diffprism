export type {
  Change,
  Hunk,
  DiffFile,
  DiffSet,
  ReviewDecision,
  ReviewComment,
  ReviewResult,
  AnnotationType,
  AnnotationCategory,
  AnnotationSource,
  Annotation,
  AnnotationReply,
  DiffSide,
  PrReviewEvent,
  PrReviewSubmission,
  ThreadAuthor,
  SessionState,
  AnnotatedChange,
  ComplexityScore,
  TestCoverageGap,
  PatternFlag,
  SecuritySeverity,
  ReviewBriefing,
  ReviewInitPayload,
  ReviewMetadata,
  GitHubPrMetadata,
  WorktreeMetadata,
  ServerMessage,
  ClientMessage,
  ReviewOptions,
  DiffUpdatePayload,
  ContextUpdatePayload,
  DiffErrorPayload,
  FileReviewStatus,
  GlobalServerInfo,
  GlobalSessionStatus,
  SessionSummary,
  GlobalServerOptions,
  GlobalServerHandle,
  PrAgentRequest,
  PrAgentHandle,
  PrAgentStarter,
  CommitInfo,
  BranchList,
  GitRefsPayload,
} from "./types.js";

export { createDiffPoller } from "./diff-poller.js";
export type { DiffPoller, DiffPollerOptions } from "./diff-poller.js";
export { hashDiff, detectChangedFiles, fileKey } from "./diff-utils.js";
export { startGlobalServer } from "./global-server.js";
export { ensureServer, submitReviewToServer, waitForDecision, ReviewTimeoutError, ReviewerAskedError } from "./server-client.js";
export { getBuildInfo, describeVersion, builtAt } from "./build-info.js";
export { MCP_TOOL_NAMES, RETIRED_MCP_TOOL_NAMES, mcpToolPermission } from "./mcp-tools.js";
export { DEFAULT_DIFF_REF, COMMIT_GATE_DIFF_REF, DIFF_REF_DESCRIPTION } from "./diff-scope.js";
export {
  ISSUES_NEW_URL,
  REPORT_HINT,
  buildFeedbackUrl,
  currentVersion,
  describeEnvironment,
  readLastError,
  recordError,
  redactHome,
} from "./feedback.js";
export type { Environment, ErrorReport, FeedbackOptions } from "./feedback.js";
export { awaitingAgent, lastAuthor, lastMessageAt, pickedUpByAgent } from "./threads.js";
export type { BuildInfo } from "./build-info.js";
export type {
  EnsureServerOptions,
  SubmitReviewOptions,
} from "./server-client.js";
export {
  writeServerFile,
  readServerFile,
  removeServerFile,
  isServerAlive,
} from "./server-file.js";
export {
  readHistory,
  appendHistory,
  getRecentHistory,
  getHistoryStats,
  getHistoryPath,
  generateEntryId,
} from "./review-history.js";
export type { ReviewHistoryEntry, ReviewHistory } from "./review-history.js";
