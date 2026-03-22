import { useEffect, useRef } from "react";
import { useReviewStore } from "../store/review";

/**
 * Reports the user's current file focus to the server via HTTP.
 * This enables the `get_user_focus` MCP tool so AI agents
 * know what the user is looking at.
 */
export function useFocusReporter() {
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const activeSessionId = useReviewStore((s) => s.activeSessionId);
  const reviewId = useReviewStore((s) => s.reviewId);
  const lastReportedRef = useRef<string | null>(null);

  useEffect(() => {
    const sessionId = activeSessionId ?? reviewId;
    if (!sessionId) return;

    const httpPort = new URLSearchParams(window.location.search).get("httpPort");
    if (!httpPort) return;

    // Avoid duplicate reports
    const key = `${sessionId}:${selectedFile}`;
    if (key === lastReportedRef.current) return;
    lastReportedRef.current = key;

    fetch(`http://localhost:${httpPort}/api/reviews/${sessionId}/focus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: selectedFile }),
    }).catch(() => {
      // Best-effort — don't break the UI if the server is unreachable
    });
  }, [selectedFile, activeSessionId, reviewId]);
}
