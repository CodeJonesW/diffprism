import { useCallback } from "react";
import { useReviewStore } from "../store/review";
import { useHttpApi } from "./useHttpApi";
import type { ReviewResult } from "../types";

/**
 * Sends the reviewer's decision and waits for the server to record it.
 *
 * Resolves true once it has. Until then the review stays on screen: if the
 * server refuses or can't be reached, the store's `verdict` says why, so the
 * action bar can show it and the reviewer can choose again — instead of the
 * review vanishing as if it went, while an agent or a commit waits on it (#203).
 */
export function useSendVerdict(): (result: ReviewResult) => Promise<boolean> {
  const { submitResult } = useHttpApi();
  const setVerdict = useReviewStore((s) => s.setVerdict);

  return useCallback(
    async (result: ReviewResult) => {
      const reviewId = useReviewStore.getState().reviewId;
      setVerdict({ state: "sending", decision: result.decision });
      const sent = reviewId
        ? await submitResult(reviewId, result)
        : { ok: false, error: "This review isn't connected to the DiffPrism server" };
      if (!sent.ok) {
        setVerdict({ state: "failed", decision: result.decision, error: sent.error ?? "The server didn't record it" });
        return false;
      }
      setVerdict({ state: "idle" });
      return true;
    },
    [submitResult, setVerdict],
  );
}
