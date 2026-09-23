import { create } from "zustand";
import type { SplitterPaneSize } from "@mantine/hooks";
import type {
  DiffSet,
  FileReviewStatus,
  ReviewBriefing,
  ReviewComment,
  ReviewDecision,
  ReviewInitPayload,
  ReviewMetadata,
  DiffUpdatePayload,
  ContextUpdatePayload,
  SessionSummary,
  Annotation,
} from "../types";
import { getFileKey } from "../lib/file-key";

const FILE_STATUS_CYCLE: FileReviewStatus[] = [
  "unreviewed",
  "reviewed",
  "approved",
  "needs_changes",
];

export type Theme = "dark" | "light";

/** The resizable panes. Each new one adds its id here and its default below. */
export type PaneId = "review-sidebar" | "review-threads" | "dashboard-sessions";

/** A pane's size (in the unit it was declared in) and whether it's collapsed. */
export interface PaneLayout {
  size: SplitterPaneSize;
  collapsed: boolean;
}

const DEFAULT_PANES: Record<PaneId, PaneLayout> = {
  "review-sidebar": { size: "280px", collapsed: false },
  // Threads share the review sidebar with the file list, which takes the rest.
  "review-threads": { size: 40, collapsed: false },
  "dashboard-sessions": { size: "260px", collapsed: false },
};

const PANES_STORAGE_KEY = "diffprism-panes";

/** Whether the PR review bar is folded down to its one-line header (#219). */
const REVIEW_BAR_STORAGE_KEY = "diffprism-review-bar-collapsed";

/**
 * The layout the viewer left, per pane, over the defaults. Stored values are
 * a preference, not a prerequisite: one that is missing or unreadable (hand-
 * edited, from an older build) gives that pane its default, never a broken
 * dashboard.
 */
function loadPanes(): Record<PaneId, PaneLayout> {
  let stored: Partial<Record<PaneId, Partial<PaneLayout>>> = {};
  try {
    stored = JSON.parse(localStorage.getItem(PANES_STORAGE_KEY) ?? "{}");
  } catch {
    stored = {};
  }
  const panes = { ...DEFAULT_PANES };
  for (const id of Object.keys(DEFAULT_PANES) as PaneId[]) {
    panes[id] = { ...DEFAULT_PANES[id], ...stored[id] };
  }
  return panes;
}

/** Where a comment is: the file, the line, and which side of the diff numbers it. */
export type CommentLocation = Pick<ReviewComment, "file" | "line" | "side">;

export interface DraftComment extends CommentLocation {
  body: string;
  type: ReviewComment["type"];
}

/**
 * Where the reviewer's decision is on its way to the server. It isn't sent
 * until the server says so: a decision that silently fails to arrive leaves
 * whoever is waiting on it (an agent, a commit) blocked with no reason (#203).
 */
export type VerdictStatus =
  | { state: "idle" }
  | { state: "sending"; decision: ReviewDecision }
  | { state: "failed"; decision: ReviewDecision; error: string };

export interface ReviewState {
  reviewId: string | null;
  diffSet: DiffSet | null;
  rawDiff: string | null;
  briefing: ReviewBriefing | null;
  metadata: ReviewMetadata | null;
  selectedFile: string | null;
  connectionStatus: "connecting" | "connected" | "disconnected";
  viewMode: "unified" | "split";
  fileStatuses: Record<string, FileReviewStatus>;
  comments: ReviewComment[];
  activeCommentKey: string | null;
  /** A thread to bring into view once its file has rendered — set by the annotation panel. */
  focusedAnnotationId: string | null;
  draftComment: DraftComment | null;
  theme: Theme;
  verdict: VerdictStatus;
  panes: Record<PaneId, PaneLayout>;
  /** The PR review bar shows only its header — the diff gets the room until it's time to decide. */
  reviewBarCollapsed: boolean;
  isWatchMode: boolean;
  watchSubmitted: boolean;
  hasUnreviewedChanges: boolean;

  // Hunk navigation
  focusedHunkIndex: number | null;
  hunkCount: number;

  // Compare ref (dynamic ref selector)
  compareRef: string | null;

  // Annotations
  annotations: Annotation[];

  // Server mode (multi-session)
  showHotkeyGuide: boolean;
  showWorkflowTips: boolean;
  isServerMode: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;

  // Actions
  toggleHotkeyGuide: () => void;
  setPane: (id: PaneId, change: Partial<PaneLayout>) => void;
  setReviewBarCollapsed: (collapsed: boolean) => void;
  toggleWorkflowTips: () => void;
  initReview: (payload: ReviewInitPayload) => void;
  selectFile: (path: string) => void;
  setConnectionStatus: (status: ReviewState["connectionStatus"]) => void;
  setViewMode: (mode: "unified" | "split") => void;
  setFileStatus: (path: string, status: FileReviewStatus) => void;
  cycleFileStatus: (path: string) => void;
  addComment: (comment: ReviewComment) => void;
  updateComment: (index: number, comment: ReviewComment) => void;
  deleteComment: (index: number) => void;
  setActiveCommentKey: (key: string | null) => void;
  focusAnnotation: (annotationId: string | null) => void;
  setDraftComment: (draft: DraftComment | null) => void;
  saveDraftComment: () => void;
  toggleTheme: () => void;
  updateDiff: (payload: DiffUpdatePayload) => void;
  updateContext: (payload: ContextUpdatePayload) => void;
  setWatchSubmitted: (submitted: boolean) => void;
  setServerMode: (isServerMode: boolean) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  addSession: (session: SessionSummary) => void;
  updateSession: (session: SessionSummary) => void;
  removeSession: (sessionId: string) => void;
  navigateHunk: (direction: "next" | "prev") => void;
  setHunkCount: (count: number) => void;
  setFocusedHunkIndex: (index: number | null) => void;
  setCompareRef: (ref: string | null) => void;
  addAnnotation: (annotation: Annotation) => void;
  /** The reviewer dismissed an annotation: apply it and persist it to the server. */
  dismissAnnotation: (annotationId: string) => void;
  /** The server reports a dismissal it already persisted: apply it, never write back. */
  applyAnnotationDismissed: (annotationId: string) => void;
  updateAnnotation: (annotation: Annotation) => void;
  selectSession: (sessionId: string) => void;
  clearReview: () => void;
  setVerdict: (verdict: VerdictStatus) => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  reviewId: null,
  diffSet: null,
  rawDiff: null,
  briefing: null,
  metadata: null,
  selectedFile: null,
  connectionStatus: "connecting",
  viewMode: "unified",
  fileStatuses: {},
  comments: [],
  activeCommentKey: null,
  focusedAnnotationId: null,
  draftComment: null,
  theme: (localStorage.getItem("diffprism-theme") as Theme) ?? "dark",
  panes: loadPanes(),
  reviewBarCollapsed: localStorage.getItem(REVIEW_BAR_STORAGE_KEY) === "true",
  verdict: { state: "idle" },
  isWatchMode: false,
  watchSubmitted: false,
  hasUnreviewedChanges: true,
  focusedHunkIndex: null,
  hunkCount: 0,
  compareRef: null,
  annotations: [],
  showHotkeyGuide: false,
  showWorkflowTips: false,
  isServerMode: false,
  sessions: [],
  activeSessionId: null,

  initReview: (payload: ReviewInitPayload) => {
    const firstFile =
      payload.diffSet.files.length > 0
        ? getFileKey(payload.diffSet.files[0])
        : null;

    const fileStatuses: Record<string, FileReviewStatus> = {};
    for (const file of payload.diffSet.files) {
      fileStatuses[getFileKey(file)] = "unreviewed";
    }

    set({
      reviewId: payload.reviewId,
      verdict: { state: "idle" },
      diffSet: payload.diffSet,
      rawDiff: payload.rawDiff,
      briefing: payload.briefing,
      metadata: payload.metadata,
      selectedFile: firstFile,
      fileStatuses,
      comments: [],
      annotations: [],
      activeCommentKey: null,
      draftComment: null,
      focusedHunkIndex: null,
      hunkCount: 0,
      compareRef: null,
      isWatchMode: payload.watchMode ?? false,
      watchSubmitted: false,
      hasUnreviewedChanges: true,
      activeSessionId: payload.reviewId,
    });
  },

  selectFile: (path: string) => {
    set({ selectedFile: path, focusedHunkIndex: null, hunkCount: 0 });
  },

  setConnectionStatus: (status: ReviewState["connectionStatus"]) => {
    set({ connectionStatus: status });
  },

  setViewMode: (mode: "unified" | "split") => {
    set({ viewMode: mode });
  },

  setFileStatus: (path: string, status: FileReviewStatus) => {
    set((state) => ({
      fileStatuses: { ...state.fileStatuses, [path]: status },
    }));
  },

  cycleFileStatus: (path: string) => {
    const current = get().fileStatuses[path] ?? "unreviewed";
    const currentIndex = FILE_STATUS_CYCLE.indexOf(current);
    const nextIndex = (currentIndex + 1) % FILE_STATUS_CYCLE.length;
    set((state) => ({
      fileStatuses: {
        ...state.fileStatuses,
        [path]: FILE_STATUS_CYCLE[nextIndex],
      },
    }));
  },

  addComment: (comment: ReviewComment) => {
    set((state) => ({ comments: [...state.comments, comment] }));
  },

  updateComment: (index: number, comment: ReviewComment) => {
    set((state) => ({
      comments: state.comments.map((c, i) => (i === index ? comment : c)),
    }));
  },

  deleteComment: (index: number) => {
    set((state) => ({
      comments: state.comments.filter((_, i) => i !== index),
    }));
  },

  focusAnnotation: (annotationId: string | null) => {
    set({ focusedAnnotationId: annotationId });
  },

  setActiveCommentKey: (key: string | null) => {
    set({ activeCommentKey: key });
    // Clear draft when closing the form
    if (key === null) {
      set({ draftComment: null });
    }
  },

  setDraftComment: (draft: DraftComment | null) => {
    set({ draftComment: draft });
  },

  saveDraftComment: () => {
    const { draftComment } = get();
    if (draftComment && draftComment.body.trim()) {
      set((state) => ({
        comments: [...state.comments, {
          file: draftComment.file,
          line: draftComment.line,
          side: draftComment.side,
          body: draftComment.body.trim(),
          type: draftComment.type,
        }],
        draftComment: null,
        activeCommentKey: null,
      }));
    }
  },

  toggleHotkeyGuide: () => {
    set((state) => ({ showHotkeyGuide: !state.showHotkeyGuide }));
  },

  toggleWorkflowTips: () => {
    set((state) => ({ showWorkflowTips: !state.showWorkflowTips }));
  },

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    localStorage.setItem("diffprism-theme", next);
    set({ theme: next });
  },

  setPane: (id: PaneId, change: Partial<PaneLayout>) => {
    // A splitter reports every collapse and expand, including ones this store
    // asked for. Only a real change is saved.
    const current = get().panes[id];
    if ((Object.keys(change) as Array<keyof PaneLayout>).every((key) => change[key] === current[key])) return;
    const panes = { ...get().panes, [id]: { ...current, ...change } };
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(panes));
    set({ panes });
  },

  setReviewBarCollapsed: (collapsed: boolean) => {
    localStorage.setItem(REVIEW_BAR_STORAGE_KEY, String(collapsed));
    set({ reviewBarCollapsed: collapsed });
  },

  updateDiff: (payload: DiffUpdatePayload) => {
    const state = get();
    const { changedFiles } = payload;

    // Preserve file statuses for unchanged files, reset changed files
    const fileStatuses: Record<string, FileReviewStatus> = {};
    for (const file of payload.diffSet.files) {
      const key = getFileKey(file);
      if (changedFiles.includes(key)) {
        fileStatuses[key] = "unreviewed";
      } else {
        fileStatuses[key] = state.fileStatuses[key] ?? "unreviewed";
      }
    }

    // Keep comments (they reference file+line, user can clean up)
    // Adjust selected file if it was removed
    let { selectedFile } = state;
    if (selectedFile && !payload.diffSet.files.some((f) => getFileKey(f) === selectedFile)) {
      selectedFile = payload.diffSet.files.length > 0
        ? getFileKey(payload.diffSet.files[0])
        : null;
    }

    set({
      diffSet: payload.diffSet,
      rawDiff: payload.rawDiff,
      briefing: payload.briefing,
      fileStatuses,
      selectedFile,
      focusedHunkIndex: null,
      hunkCount: 0,
      hasUnreviewedChanges: true,
    });
  },

  updateContext: (payload: ContextUpdatePayload) => {
    const state = get();
    if (!state.metadata) return;

    set({
      metadata: {
        ...state.metadata,
        ...(payload.reasoning !== undefined && { reasoning: payload.reasoning }),
        ...(payload.title !== undefined && { title: payload.title }),
        ...(payload.description !== undefined && { description: payload.description }),
      },
    });
  },

  setWatchSubmitted: (submitted: boolean) => {
    set({
      watchSubmitted: submitted,
      ...(submitted && { hasUnreviewedChanges: false }),
    });
  },

  setServerMode: (isServerMode: boolean) => {
    set({ isServerMode });
  },

  setSessions: (sessions: SessionSummary[]) => {
    set({ sessions });
  },

  addSession: (session: SessionSummary) => {
    set((state) => {
      if (state.sessions.some((s) => s.id === session.id)) {
        return state;
      }
      return { sessions: [...state.sessions, session] };
    });
  },

  updateSession: (session: SessionSummary) => {
    set((state) => {
      const idx = state.sessions.findIndex((s) => s.id === session.id);
      if (idx === -1) return state;
      const sessions = [...state.sessions];
      sessions[idx] = session;
      return { sessions };
    });
  },

  removeSession: (sessionId: string) => {
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      if (state.activeSessionId === sessionId) {
        return {
          sessions,
          reviewId: null,
          diffSet: null,
          rawDiff: null,
          briefing: null,
          metadata: null,
          selectedFile: null,
          fileStatuses: {},
          comments: [],
          activeCommentKey: null,
          draftComment: null,
          focusedHunkIndex: null,
          hunkCount: 0,
          compareRef: null,
          activeSessionId: null,
          watchSubmitted: false,
          hasUnreviewedChanges: true,
        };
      }
      return { sessions };
    });
  },

  navigateHunk: (direction: "next" | "prev") => {
    const { focusedHunkIndex, hunkCount } = get();
    if (hunkCount === 0) return;
    if (focusedHunkIndex === null) {
      set({ focusedHunkIndex: direction === "next" ? 0 : hunkCount - 1 });
    } else if (direction === "next") {
      set({ focusedHunkIndex: Math.min(focusedHunkIndex + 1, hunkCount - 1) });
    } else {
      set({ focusedHunkIndex: Math.max(focusedHunkIndex - 1, 0) });
    }
  },

  setHunkCount: (count: number) => {
    set({ hunkCount: count, focusedHunkIndex: null });
  },

  setFocusedHunkIndex: (index: number | null) => {
    set({ focusedHunkIndex: index });
  },

  setCompareRef: (ref: string | null) => {
    set({ compareRef: ref });
  },

  addAnnotation: (annotation: Annotation) => {
    set((state) => {
      // needsAttention is not set here. It is server state, carried on every
      // session summary; setting it client-side meant the next session:list or
      // session:updated replaced the object and wiped it.
      return { annotations: [...state.annotations, annotation] };
    });
  },

  // A thread changed on the server — a reply landed. Replace it wholesale:
  // the server's copy is the conversation.
  updateAnnotation: (annotation: Annotation) => {
    set((state) => ({
      annotations: state.annotations.map((a) => (a.id === annotation.id ? annotation : a)),
    }));
  },

  applyAnnotationDismissed: (annotationId: string) => {
    set((state) => ({
      annotations: state.annotations.map((a) =>
        a.id === annotationId ? { ...a, dismissed: true } : a,
      ),
    }));
  },

  dismissAnnotation: (annotationId: string) => {
    get().applyAnnotationDismissed(annotationId);

    // Persist dismissal to server (fire-and-forget)
    const params = new URLSearchParams(window.location.search);
    const httpPort = params.get("httpPort");
    const sessionId = get().reviewId;
    if (httpPort && sessionId) {
      fetch(
        `http://localhost:${httpPort}/api/reviews/${sessionId}/annotations/${annotationId}/dismiss`,
        { method: "POST" },
      ).catch(() => {
        // Ignore network errors — local state is already updated
      });
    }
  },

  selectSession: (sessionId: string) => {
    set({ activeSessionId: sessionId });
  },

  clearReview: () => {
    set({
      reviewId: null,
      verdict: { state: "idle" },
      diffSet: null,
      rawDiff: null,
      briefing: null,
      metadata: null,
      selectedFile: null,
      fileStatuses: {},
      comments: [],
      annotations: [],
      activeCommentKey: null,
      draftComment: null,
      focusedHunkIndex: null,
      hunkCount: 0,
      compareRef: null,
      activeSessionId: null,
      watchSubmitted: false,
      hasUnreviewedChanges: true,
    });
  },

  setVerdict: (verdict: VerdictStatus) => {
    set({ verdict });
  },
}));
