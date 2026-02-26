import { create } from "zustand";
import type {
  DiffSet,
  FileReviewStatus,
  ReviewBriefing,
  ReviewComment,
  ReviewInitPayload,
  ReviewMetadata,
  DiffUpdatePayload,
  ContextUpdatePayload,
  SessionSummary,
} from "../types";
import { getFileKey } from "../lib/file-key";

const FILE_STATUS_CYCLE: FileReviewStatus[] = [
  "unreviewed",
  "reviewed",
  "approved",
  "needs_changes",
];

export type Theme = "dark" | "light";

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
  theme: Theme;
  isWatchMode: boolean;
  watchSubmitted: boolean;
  hasUnreviewedChanges: boolean;

  // Hunk navigation
  focusedHunkIndex: number | null;
  hunkCount: number;

  // Compare ref (dynamic ref selector)
  compareRef: string | null;

  // Server mode (multi-session)
  showHotkeyGuide: boolean;
  isServerMode: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;

  // Actions
  toggleHotkeyGuide: () => void;
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
  selectSession: (sessionId: string) => void;
  clearReview: () => void;
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
  theme: (localStorage.getItem("diffprism-theme") as Theme) ?? "dark",
  isWatchMode: false,
  watchSubmitted: false,
  hasUnreviewedChanges: true,
  focusedHunkIndex: null,
  hunkCount: 0,
  compareRef: null,
  showHotkeyGuide: false,
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
      diffSet: payload.diffSet,
      rawDiff: payload.rawDiff,
      briefing: payload.briefing,
      metadata: payload.metadata,
      selectedFile: firstFile,
      fileStatuses,
      comments: [],
      activeCommentKey: null,
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

  setActiveCommentKey: (key: string | null) => {
    set({ activeCommentKey: key });
  },

  toggleHotkeyGuide: () => {
    set((state) => ({ showHotkeyGuide: !state.showHotkeyGuide }));
  },

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    localStorage.setItem("diffprism-theme", next);
    set({ theme: next });
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

  selectSession: (sessionId: string) => {
    set({ activeSessionId: sessionId });
  },

  clearReview: () => {
    set({
      reviewId: null,
      diffSet: null,
      rawDiff: null,
      briefing: null,
      metadata: null,
      selectedFile: null,
      fileStatuses: {},
      comments: [],
      activeCommentKey: null,
      focusedHunkIndex: null,
      hunkCount: 0,
      compareRef: null,
      activeSessionId: null,
      watchSubmitted: false,
      hasUnreviewedChanges: true,
    });
  },
}));
