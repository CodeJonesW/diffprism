import { useEffect, useRef, useCallback } from "react";
import { useReviewStore } from "../store/review";
import type { ReviewResult, ServerMessage, ClientMessage, SessionSummary, DiffUpdatePayload, Annotation } from "../types";

interface UseWebSocketOptions {
  onSessionAdded?: (session: SessionSummary) => void;
  onSessionUpdated?: (session: SessionSummary) => void;
  onDiffUpdated?: (fileCount: number) => void;
  onAnnotationAdded?: (annotation: Annotation) => void;
}

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
    dismissAnnotation,
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

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnectionStatus("connected");
    });

    ws.addEventListener("message", (event) => {
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
          dismissAnnotation(message.payload.annotationId);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    });

    ws.addEventListener("close", () => {
      setConnectionStatus("disconnected");
    });

    ws.addEventListener("error", () => {
      setConnectionStatus("disconnected");
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [setConnectionStatus, initReview, updateDiff, updateContext, setServerMode, setSessions, addSession, updateSession, removeSession, addAnnotation, dismissAnnotation]);

  const sendResult = useCallback((result: ReviewResult) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error("WebSocket is not connected");
      return;
    }

    const message: ClientMessage = {
      type: "review:submit",
      payload: result,
    };

    ws.send(JSON.stringify(message));
  }, []);

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

  return { sendResult, selectSession, closeSession, connectionStatus };
}
