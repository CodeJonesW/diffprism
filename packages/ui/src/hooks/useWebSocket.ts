import { useEffect, useRef, useCallback } from "react";
import { useReviewStore } from "../store/review";
import type { ReviewResult, ServerMessage, ClientMessage } from "../types";

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { connectionStatus, setConnectionStatus, initReview } =
    useReviewStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wsPort = params.get("wsPort");

    if (!wsPort) {
      console.warn("No wsPort query parameter found");
      setConnectionStatus("disconnected");
      return;
    }

    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnectionStatus("connected");
    });

    ws.addEventListener("message", (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data as string);

        if (message.type === "review:init") {
          initReview(message.payload);
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
  }, [setConnectionStatus, initReview]);

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

  return { sendResult, connectionStatus };
}
