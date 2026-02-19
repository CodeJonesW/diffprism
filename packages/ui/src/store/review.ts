import { create } from "zustand";
import type {
  DiffSet,
  FileReviewStatus,
  ReviewBriefing,
  ReviewComment,
  ReviewInitPayload,
  ReviewMetadata,
} from "../types";

const FILE_STATUS_CYCLE: FileReviewStatus[] = [
  "unreviewed",
  "reviewed",
  "approved",
  "needs_changes",
];

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
}));
