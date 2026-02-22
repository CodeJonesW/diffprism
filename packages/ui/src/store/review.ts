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
} from "../types";

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

  // Actions
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

  initReview: (payload: ReviewInitPayload) => {
    const firstFile =
      payload.diffSet.files.length > 0
        ? payload.diffSet.files[0].path
        : null;

    const fileStatuses: Record<string, FileReviewStatus> = {};
    for (const file of payload.diffSet.files) {
      fileStatuses[file.path] = "unreviewed";
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
      isWatchMode: payload.watchMode ?? false,
      watchSubmitted: false,
    });
  },

  selectFile: (path: string) => {
    set({ selectedFile: path });
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
      if (changedFiles.includes(file.path)) {
        fileStatuses[file.path] = "unreviewed";
      } else {
        fileStatuses[file.path] = state.fileStatuses[file.path] ?? "unreviewed";
      }
    }

    // Keep comments (they reference file+line, user can clean up)
    // Adjust selected file if it was removed
    let { selectedFile } = state;
    if (selectedFile && !payload.diffSet.files.some((f) => f.path === selectedFile)) {
      selectedFile = payload.diffSet.files.length > 0
        ? payload.diffSet.files[0].path
        : null;
    }

    set({
      diffSet: payload.diffSet,
      rawDiff: payload.rawDiff,
      briefing: payload.briefing,
      fileStatuses,
      selectedFile,
      watchSubmitted: false,
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
    set({ watchSubmitted: submitted });
  },
}));
