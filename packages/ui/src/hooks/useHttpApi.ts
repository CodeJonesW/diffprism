import { useCallback, useMemo } from "react";
import type { GitRefsPayload } from "../types";

export interface CompareResult {
  ok: boolean;
  error?: string;
}

export function useHttpApi() {
  const httpPort = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("httpPort");
  }, []);

  const isAvailable = httpPort !== null;

  const fetchRefs = useCallback(
    async (sessionId: string): Promise<GitRefsPayload | null> => {
      if (!httpPort) return null;
      try {
        const response = await fetch(
          `http://localhost:${httpPort}/api/reviews/${sessionId}/refs`,
        );
        if (!response.ok) return null;
        return (await response.json()) as GitRefsPayload;
      } catch {
        return null;
      }
    },
    [httpPort],
  );

  const compareAgainst = useCallback(
    async (sessionId: string, ref: string): Promise<CompareResult> => {
      if (!httpPort) return { ok: false, error: "Not connected to server" };
      try {
        const response = await fetch(
          `http://localhost:${httpPort}/api/reviews/${sessionId}/compare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ref }),
          },
        );
        if (response.ok) return { ok: true };
        const body = await response.json().catch(() => ({})) as { error?: string };
        return { ok: false, error: body.error ?? "Comparison failed" };
      } catch {
        return { ok: false, error: "Failed to connect to server" };
      }
    },
    [httpPort],
  );

  /** Return to the ref the session was opened with — the server knows which. */
  const resetCompare = useCallback(
    async (sessionId: string): Promise<CompareResult> => {
      if (!httpPort) return { ok: false, error: "Not connected to server" };
      try {
        const response = await fetch(
          `http://localhost:${httpPort}/api/reviews/${sessionId}/compare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reset: true }),
          },
        );
        if (response.ok) return { ok: true };
        const body = await response.json().catch(() => ({})) as { error?: string };
        return { ok: false, error: body.error ?? "Reset failed" };
      } catch {
        return { ok: false, error: "Failed to connect to server" };
      }
    },
    [httpPort],
  );

  /**
   * Post to the server and let the broadcast update the screen. Nothing is
   * added to the store optimistically: the WebSocket echo is the single path
   * a thread takes into the UI, so what the reviewer sees is what the agent
   * sees.
   */
  const postJson = useCallback(
    async (path: string, body: unknown): Promise<CompareResult> => {
      if (!httpPort) return { ok: false, error: "Not connected to server" };
      try {
        const response = await fetch(`http://localhost:${httpPort}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.ok) return { ok: true };
        const data = await response.json().catch(() => ({})) as { error?: string };
        return { ok: false, error: data.error ?? "Request failed" };
      } catch {
        return { ok: false, error: "Failed to connect to server" };
      }
    },
    [httpPort],
  );

  /** Open a conversation on a line, as the reviewer. */
  const startThread = useCallback(
    (sessionId: string, thread: { file: string; line: number; body: string }) =>
      postJson(`/api/reviews/${sessionId}/annotations`, {
        ...thread,
        type: "question",
        category: "other",
        author: "reviewer",
        source: { agent: "reviewer", tool: "dashboard" },
      }),
    [postJson],
  );

  /** Reply to a thread, as the reviewer. */
  const replyToThread = useCallback(
    (sessionId: string, annotationId: string, body: string) =>
      postJson(`/api/reviews/${sessionId}/annotations/${annotationId}/replies`, {
        author: "reviewer",
        body,
      }),
    [postJson],
  );

  return { isAvailable, fetchRefs, compareAgainst, resetCompare, startThread, replyToThread };
}
