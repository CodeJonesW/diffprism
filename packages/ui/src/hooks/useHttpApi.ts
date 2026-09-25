import { useCallback, useMemo } from "react";
import type { AgentSettings, DiffSide, DojoAvailableAgent, ReviewAgentName, GitRefsPayload, PrReviewSubmission, ReviewResult } from "../types";

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

  /**
   * Send the reviewer's decision. Resolves once the server has recorded it, or
   * with its reason for refusing — the answer a WebSocket message never gave.
   */
  const submitResult = useCallback(
    (sessionId: string, result: ReviewResult) => postJson(`/api/reviews/${sessionId}/result`, result),
    [postJson],
  );

  /** Open a conversation on a line, as the reviewer. */
  const startThread = useCallback(
    (sessionId: string, thread: { file: string; line: number; side: DiffSide; body: string }) =>
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

  /**
   * Post the reviewer's decision on a PR to GitHub. Resolves once GitHub has
   * accepted it, with the review's URL, or with GitHub's reason for refusing.
   */
  const submitPrReview = useCallback(
    async (sessionId: string, submission: PrReviewSubmission): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
      if (!httpPort) return { ok: false, error: "Not connected to server" };
      try {
        const response = await fetch(`http://localhost:${httpPort}/api/reviews/${sessionId}/github-review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submission),
        });
        const data = await response.json().catch(() => ({})) as { url?: string; error?: string };
        if (response.ok && data.url) return { ok: true, url: data.url };
        return { ok: false, error: data.error ?? `Server returned ${response.status}` };
      } catch {
        return { ok: false, error: "Failed to connect to server" };
      }
    },
    [httpPort],
  );

  /** The saved agent settings, or why they can't be read (#226). */
  const getAgentSettings = useCallback(
    async (): Promise<{ ok: true; settings: AgentSettings } | { ok: false; error: string }> => {
      if (!httpPort) return { ok: false, error: "Not connected to server" };
      try {
        const response = await fetch(`http://localhost:${httpPort}/api/settings/agent`);
        const data = (await response.json().catch(() => ({}))) as { settings?: AgentSettings; error?: string };
        if (response.ok && data.settings) return { ok: true, settings: data.settings };
        return { ok: false, error: data.error ?? `Server returned ${response.status}` };
      } catch {
        return { ok: false, error: "Failed to connect to server" };
      }
    },
    [httpPort],
  );

  /** Save the agent settings. Resolves with what was saved, or the server's reason for refusing. */
  const saveAgentSettings = useCallback(
    async (settings: AgentSettings): Promise<{ ok: true; settings: AgentSettings } | { ok: false; error: string }> => {
      if (!httpPort) return { ok: false, error: "Not connected to server" };
      try {
        const response = await fetch(`http://localhost:${httpPort}/api/settings/agent`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        });
        const data = (await response.json().catch(() => ({}))) as { settings?: AgentSettings; error?: string };
        if (response.ok && data.settings) return { ok: true, settings: data.settings };
        return { ok: false, error: data.error ?? `Server returned ${response.status}` };
      } catch {
        return { ok: false, error: "Failed to connect to server" };
      }
    },
    [httpPort],
  );

  /** The agents a review dojo can seat on this machine (#231). */
  const getDojoAgents = useCallback(
    async (): Promise<{ ok: true; agents: DojoAvailableAgent[] } | { ok: false; error: string }> => {
      if (!httpPort) return { ok: false, error: "Not connected to server" };
      try {
        const response = await fetch(`http://localhost:${httpPort}/api/dojo/agents`);
        const data = (await response.json().catch(() => ({}))) as { agents?: DojoAvailableAgent[]; error?: string };
        if (response.ok && data.agents) return { ok: true, agents: data.agents };
        return { ok: false, error: data.error ?? `Server returned ${response.status}` };
      } catch {
        return { ok: false, error: "Failed to connect to server" };
      }
    },
    [httpPort],
  );

  /** Start a review dojo. Its progress and result arrive as dojo:update. */
  const startDojo = useCallback(
    (sessionId: string, agents: ReviewAgentName[]) => postJson(`/api/reviews/${sessionId}/dojo`, { agents }),
    [postJson],
  );

  return {
    isAvailable,
    fetchRefs,
    compareAgainst,
    resetCompare,
    submitResult,
    startThread,
    replyToThread,
    submitPrReview,
    getAgentSettings,
    saveAgentSettings,
    getDojoAgents,
    startDojo,
  };
}
