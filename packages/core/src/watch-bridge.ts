import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ReviewResult,
  ReviewInitPayload,
  DiffUpdatePayload,
  ContextUpdatePayload,
  DiffErrorPayload,
  GitRefsPayload,
  ServerMessage,
  ClientMessage,
} from "./types.js";

export interface WatchBridge {
  port: number;
  sendInit: (payload: ReviewInitPayload) => void;
  storeInitPayload: (payload: ReviewInitPayload) => void;
  sendDiffUpdate: (payload: DiffUpdatePayload) => void;
  sendContextUpdate: (payload: ContextUpdatePayload) => void;
  sendDiffError: (payload: DiffErrorPayload) => void;
  onSubmit: (callback: (result: ReviewResult) => void) => void;
  waitForResult: () => Promise<ReviewResult>;
  triggerRefresh: () => void;
  close: () => Promise<void>;
}

export interface WatchBridgeCallbacks {
  onRefreshRequest: () => void;
  onContextUpdate: (payload: ContextUpdatePayload) => void;
  onDiffRefChange?: (diffRef: string) => void;
  onRefsRequest?: () => Promise<GitRefsPayload | null>;
  onCompareRequest?: (ref: string) => Promise<boolean>;
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
  let resultReject: ((err: Error) => void) | null = null;

  // Create HTTP server with API routes
  const httpServer = http.createServer(async (req, res) => {
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

    // Strip query string for route matching
    const pathname = (req.url ?? "").split("?")[0];

    // GET /api/refs or /api/reviews/:id/refs
    if (req.method === "GET" && (pathname === "/api/refs" || /^\/api\/reviews\/[^/]+\/refs$/.test(pathname))) {
      if (callbacks.onRefsRequest) {
        const refsPayload = await callbacks.onRefsRequest();
        if (refsPayload) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(refsPayload));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to list git refs" }));
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // POST /api/compare or /api/reviews/:id/compare
    if (req.method === "POST" && (pathname === "/api/compare" || /^\/api\/reviews\/[^/]+\/compare$/.test(pathname))) {
      if (callbacks.onCompareRequest) {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", async () => {
          try {
            const { ref } = JSON.parse(body) as { ref: string };
            if (!ref) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing ref" }));
              return;
            }
            const success = await callbacks.onCompareRequest!(ref);
            if (success) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            } else {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Failed to compute diff" }));
            }
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
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
        } else if (msg.type === "diff:change_ref" && callbacks.onDiffRefChange) {
          callbacks.onDiffRefChange(msg.payload.diffRef);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      client = null;
      // Grace period for reconnects (React dev mode, page reload)
      if (resultReject) {
        closeTimer = setTimeout(() => {
          closeTimer = null;
          if (resultReject) {
            resultReject(new Error("Browser closed before review was submitted"));
            resultReject = null;
            submitCallback = null;
          }
        }, 2000);
      } else {
        closeTimer = setTimeout(() => {
          closeTimer = null;
        }, 2000);
      }
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

        storeInitPayload(payload: ReviewInitPayload) {
          initPayload = payload;
        },

        sendDiffUpdate(payload: DiffUpdatePayload) {
          sendToClient({ type: "diff:update", payload });
        },

        sendContextUpdate(payload: ContextUpdatePayload) {
          sendToClient({ type: "context:update", payload });
        },

        sendDiffError(payload: DiffErrorPayload) {
          sendToClient({ type: "diff:error", payload });
        },

        onSubmit(callback: (result: ReviewResult) => void) {
          submitCallback = callback;
        },

        waitForResult(): Promise<ReviewResult> {
          return new Promise<ReviewResult>((resolve, reject) => {
            submitCallback = resolve;
            resultReject = reject;
          });
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
