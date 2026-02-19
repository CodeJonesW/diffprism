import { create } from "zustand";
import type {
  DiffSet,
  ReviewBriefing,
  ReviewInitPayload,
  ReviewMetadata,
} from "../types";

export interface ReviewState {
  reviewId: string | null;
  diffSet: DiffSet | null;
  rawDiff: string | null;
  briefing: ReviewBriefing | null;
  metadata: ReviewMetadata | null;
  selectedFile: string | null;
  connectionStatus: "connecting" | "connected" | "disconnected";
  viewMode: "unified" | "split";

  // Actions
  initReview: (payload: ReviewInitPayload) => void;
  selectFile: (path: string) => void;
  setConnectionStatus: (status: ReviewState["connectionStatus"]) => void;
  setViewMode: (mode: "unified" | "split") => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  reviewId: null,
  diffSet: null,
  rawDiff: null,
  briefing: null,
  metadata: null,
  selectedFile: null,
  connectionStatus: "connecting",
  viewMode: "unified",

  initReview: (payload: ReviewInitPayload) => {
    const firstFile =
      payload.diffSet.files.length > 0
        ? payload.diffSet.files[0].path
        : null;

    set({
      reviewId: payload.reviewId,
      diffSet: payload.diffSet,
      rawDiff: payload.rawDiff,
      briefing: payload.briefing,
      metadata: payload.metadata,
      selectedFile: firstFile,
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
}));
