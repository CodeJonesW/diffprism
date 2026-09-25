import { useEffect, useRef, useCallback } from "react";
import { useReviewStore } from "../store/review";
import type { ServerMessage, ClientMessage, SessionSummary, DiffUpdatePayload, Annotation } from "../types";

interface UseWebSocketOptions {
  onSessionAdded?: (session: SessionSummary) => void;
  onSessionUpdated?: (session: SessionSummary) => void;
  onDiffUpdated?: (fileCount: number) => void;
  onAnnotationAdded?: (annotation: Annotation) => void;
}

/** How long to wait before reconnecting to the server after the connection drops. */
const RECONNECT_DELAY_MS = 1000;

export function useWebSocket(options?: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const onSessionAddedRef = useRef(options?.onSessionAdded);
  onSessionAddedRef.current = options?.onSessionAdded;
  const onSessionUpdatedRef = useRef(options?.onSessionUpdated);
  onSessionUpdatedRef.current = options?.onSessionUpdated;
  const onDiffUpdatedRef = useRef(options?.onDiffUpdated);
  onDiffUpdatedRef.current = options?.onDiffUpdated;
  const onAnnotationAddedRef = useRef(options?.onAnnotationAdded);
  onAnnotationAddedRef.current = options?.onAnnotationAdded;

  const {
    connectionStatus,
    setConnectionStatus,
    initReview,
    updateDiff,
    updateContext,
    setServerMode,
    setSessions,
    addSession,
    updateSession,
    removeSession,
    addAnnotation,
    applyAnnotationDismissed,
    updateAnnotation,
    setDojo,
  } = useReviewStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wsPort = params.get("wsPort");
    const serverMode = params.get("serverMode") === "true";
    const sessionId = params.get("sessionId");

    if (!wsPort) {
      console.warn("No wsPort query parameter found");
      setConnectionStatus("disconnected");
      return;
    }

    if (serverMode) {
      setServerMode(true);
    }

    // In server mode without a specific session, connect without sessionId
    // so the server sends the session list
    const wsUrl = sessionId
      ? `ws://localhost:${wsPort}?sessionId=${sessionId}`
      : `ws://localhost:${wsPort}`;

    const onMessage = (event: MessageEvent) => {
      try {
        const message: ServerMessage = JSON.parse(event.data as string);

        if (message.type === "review:init") {
          initReview(message.payload);
        } else if (message.type === "diff:update") {
          updateDiff(message.payload);
          const payload = message.payload as DiffUpdatePayload;
          onDiffUpdatedRef.current?.(payload.diffSet.files.length);
        } else if (message.type === "diff:error") {
          console.error("Diff error:", message.payload.error);
        } else if (message.type === "context:update") {
          updateContext(message.payload);
        } else if (message.type === "session:list") {
          setSessions(message.payload);
        } else if (message.type === "session:added") {
          addSession(message.payload);
          window.focus();
          onSessionAddedRef.current?.(message.payload);
        } else if (message.type === "session:updated") {
          updateSession(message.payload);
          onSessionUpdatedRef.current?.(message.payload);
        } else if (message.type === "session:removed") {
          removeSession(message.payload.sessionId);
        } else if (message.type === "annotation:added") {
          addAnnotation(message.payload);
          onAnnotationAddedRef.current?.(message.payload as Annotation);
        } else if (message.type === "annotation:dismissed") {
          applyAnnotationDismissed(message.payload.annotationId);
        } else if (message.type === "annotation:updated") {
          updateAnnotation(message.payload);
        } else if (message.type === "dojo:update") {
          setDojo(message.payload);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    // The dashboard outlives the server it first talked to: a newer build
    // replaces the server, `diffprism server stop` ends it. Reconnect instead
    // of sitting disconnected — otherwise the next review finds no dashboard
    // connected and opens yet another tab (#188).
    const httpPort = params.get("httpPort");
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let serverPid: number | null = null;
    let hasConnected = false;

    const readServerPid = async (): Promise<number | null> => {
      if (!httpPort) return null;
      try {
        const response = await fetch(`http://localhost:${httpPort}/api/status`);
        if (!response.ok) {
          console.warn(`DiffPrism server status returned ${response.status}`);
          return null;
        }
        return ((await response.json()) as { pid: number }).pid;
      } catch (err) {
        console.warn("Could not read DiffPrism server status:", err);
        return null;
      }
    };

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener("open", async () => {
        setConnectionStatus("connected");
        const reconnected = hasConnected;
        hasConnected = true;
        const pid = await readServerPid();
        if (reconnected && serverPid !== null && pid !== null && pid !== serverPid) {
          // A different server: none of the sessions on screen exist in it, and
          // it may be a newer build with a newer dashboard. Start over.
          window.location.reload();
          return;
        }
        if (pid !== null) serverPid = pid;
        if (reconnected) {
          // Same server, dropped connection: it forgot which session this tab views.
          const activeSessionId = useReviewStore.getState().activeSessionId;
          if (activeSessionId) {
            ws.send(JSON.stringify({ type: "session:select", payload: { sessionId: activeSessionId } }));
          }
        }
      });

      ws.addEventListener("message", onMessage);

      ws.addEventListener("close", () => {
        setConnectionStatus("disconnected");
        if (!disposed) {
          retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });

      ws.addEventListener("error", () => {
        setConnectionStatus("disconnected");
      });
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [setConnectionStatus, initReview, updateDiff, updateContext, setServerMode, setSessions, addSession, updateSession, removeSession, addAnnotation, applyAnnotationDismissed, updateAnnotation, setDojo]);

  const selectSession = useCallback((sessionId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error("WebSocket is not connected");
      return;
    }

    const message: ClientMessage = {
      type: "session:select",
      payload: { sessionId },
    };

    ws.send(JSON.stringify(message));
  }, []);

  const closeSession = useCallback((sessionId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error("WebSocket is not connected");
      return;
    }

    const message: ClientMessage = {
      type: "session:close",
      payload: { sessionId },
    };

    ws.send(JSON.stringify(message));
  }, []);

  return { selectSession, closeSession, connectionStatus };
}
