import { WebSocketServer, WebSocket } from "ws";
import type {
  ReviewResult,
  ReviewInitPayload,
  ServerMessage,
  ClientMessage,
} from "./types.js";

export interface WsBridge {
  port: number;
  sendInit: (payload: ReviewInitPayload) => void;
  waitForResult: () => Promise<ReviewResult>;
  close: () => void;
}

export function createWsBridge(port: number): WsBridge {
  const wss = new WebSocketServer({ port });

  let client: WebSocket | null = null;
  let resultResolve: ((result: ReviewResult) => void) | null = null;
  let resultReject: ((err: Error) => void) | null = null;
  let pendingInit: ReviewInitPayload | null = null;
  let initPayload: ReviewInitPayload | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  wss.on("connection", (ws) => {
    // New client connected — cancel any pending close rejection
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }

    client = ws;

    // Send init payload (either pending or replaying for reconnects)
    const payload = pendingInit ?? initPayload;
    if (payload) {
      const msg: ServerMessage = {
        type: "review:init",
        payload,
      };
      ws.send(JSON.stringify(msg));
      pendingInit = null;
    }

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        if (msg.type === "review:submit" && resultResolve) {
          resultResolve(msg.payload);
          resultResolve = null;
          resultReject = null;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      client = null;
      // Delay rejection to allow for reconnects (React dev mode, page reload)
      if (resultReject) {
        closeTimer = setTimeout(() => {
          if (resultReject) {
            resultReject(new Error("Browser closed before review was submitted"));
            resultResolve = null;
            resultReject = null;
          }
        }, 2000);
      }
    });
  });

  return {
    port,

    sendInit(payload: ReviewInitPayload) {
      initPayload = payload; // Store for reconnect replays

      if (client && client.readyState === WebSocket.OPEN) {
        const msg: ServerMessage = {
          type: "review:init",
          payload,
        };
        client.send(JSON.stringify(msg));
      } else {
        pendingInit = payload;
      }
    },

    waitForResult(): Promise<ReviewResult> {
      return new Promise<ReviewResult>((resolve, reject) => {
        resultResolve = resolve;
        resultReject = reject;
      });
    },

    close() {
      for (const ws of wss.clients) {
        ws.close();
      }
      wss.close();
    },
  };
}
