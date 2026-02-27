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
  CommitInfo,
  BranchList,
  GitRefsPayload,
} from "./types.js";

export { createDiffPoller } from "./diff-poller.js";
export type { DiffPoller, DiffPollerOptions } from "./diff-poller.js";
export { hashDiff, detectChangedFiles, fileKey } from "./diff-utils.js";
export { startGlobalServer } from "./global-server.js";
export { ensureServer, submitReviewToServer } from "./server-client.js";
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
