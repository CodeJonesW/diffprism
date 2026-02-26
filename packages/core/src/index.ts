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
  ServerMessage,
  ClientMessage,
  ReviewOptions,
  WatchOptions,
  WatchHandle,
  DiffUpdatePayload,
  ContextUpdatePayload,
  DiffErrorPayload,
  WatchFileInfo,
  FileReviewStatus,
  ReviewResultFile,
  GlobalServerInfo,
  GlobalSessionStatus,
  SessionSummary,
  GlobalServerOptions,
  GlobalServerHandle,
  CommitInfo,
  BranchList,
  GitRefsPayload,
} from "./types.js";

export { startReview } from "./pipeline.js";
export { startWatch } from "./watch.js";
export { createDiffPoller } from "./diff-poller.js";
export type { DiffPoller, DiffPollerOptions } from "./diff-poller.js";
export { hashDiff, detectChangedFiles, fileKey } from "./diff-utils.js";
export { readWatchFile, readReviewResult, consumeReviewResult } from "./watch-file.js";
export { startGlobalServer } from "./global-server.js";
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
