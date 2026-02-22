import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ReviewResult,
  ReviewInitPayload,
  DiffUpdatePayload,
  ContextUpdatePayload,
  ServerMessage,
  ClientMessage,
} from "./types.js";

export interface WatchBridge {
  port: number;
  sendInit: (payload: ReviewInitPayload) => void;
  sendDiffUpdate: (payload: DiffUpdatePayload) => void;
  sendContextUpdate: (payload: ContextUpdatePayload) => void;
  onSubmit: (callback: (result: ReviewResult) => void) => void;
  triggerRefresh: () => void;
  close: () => Promise<void>;
}

export interface WatchBridgeCallbacks {
  onRefreshRequest: () => void;
  onContextUpdate: (payload: ContextUpdatePayload) => void;
}

export function createWatchBridge(
  port: number,
  callbacks: WatchBridgeCallbacks,
): Promise<WatchBridge> {
  let client: WebSocket | null = null;
  let initPayload: ReviewInitPayload | null = null;
  let pendingInit: ReviewInitPayload | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let submitCallback: ((result: ReviewResult) => void) | null = null;

  // Create HTTP server with API routes
  const httpServer = http.createServer((req, res) => {
    // CORS headers for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ running: true, pid: process.pid }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/context") {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body) as ContextUpdatePayload;
          callbacks.onContextUpdate(payload);

          // Forward to WS client
          sendToClient({ type: "context:update", payload });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/refresh") {
      callbacks.onRefreshRequest();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  // Attach WebSocket server to the same HTTP server
  const wss = new WebSocketServer({ server: httpServer });

  function sendToClient(msg: ServerMessage): void {
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }

  wss.on("connection", (ws) => {
    // Cancel any pending close timer
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }

    client = ws;

    // Send init payload (pending or stored for reconnects)
    const payload = pendingInit ?? initPayload;
    if (payload) {
      sendToClient({ type: "review:init", payload });
      pendingInit = null;
    }

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        if (msg.type === "review:submit" && submitCallback) {
          submitCallback(msg.payload);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      client = null;
      // Grace period for reconnects (React dev mode, page reload)
      closeTimer = setTimeout(() => {
        closeTimer = null;
      }, 2000);
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(port, () => {
      resolve({
        port,

        sendInit(payload: ReviewInitPayload) {
          initPayload = payload;
          if (client && client.readyState === WebSocket.OPEN) {
            sendToClient({ type: "review:init", payload });
          } else {
            pendingInit = payload;
          }
        },

        sendDiffUpdate(payload: DiffUpdatePayload) {
          sendToClient({ type: "diff:update", payload });
        },

        sendContextUpdate(payload: ContextUpdatePayload) {
          sendToClient({ type: "context:update", payload });
        },

        onSubmit(callback: (result: ReviewResult) => void) {
          submitCallback = callback;
        },

        triggerRefresh() {
          callbacks.onRefreshRequest();
        },

        async close() {
          if (closeTimer) {
            clearTimeout(closeTimer);
          }
          for (const ws of wss.clients) {
            ws.close();
          }
          wss.close();
          await new Promise<void>((resolve) => {
            httpServer.close(() => resolve());
          });
        },
      });
    });
  });
}
