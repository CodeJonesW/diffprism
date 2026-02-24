import http from "node:http";
import { randomUUID } from "node:crypto";
import getPort from "get-port";
import open from "open";
import { WebSocketServer, WebSocket } from "ws";

import { getDiff } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import type {
  GlobalServerOptions,
  GlobalServerHandle,
  GlobalServerInfo,
  SessionSummary,
  GlobalSessionStatus,
  ReviewInitPayload,
  ReviewResult,
  ContextUpdatePayload,
  ServerMessage,
  ClientMessage,
  DiffSet,
} from "./types.js";
import { writeServerFile, removeServerFile } from "./server-file.js";
import {
  resolveUiDist,
  resolveUiRoot,
  startViteDevServer,
  createStaticServer,
} from "./ui-server.js";
import { hashDiff, detectChangedFiles } from "./diff-utils.js";

// ─── In-memory session store ───

interface Session {
  id: string;
  payload: ReviewInitPayload;
  projectPath: string;
  status: GlobalSessionStatus;
  result: ReviewResult | null;
  createdAt: number;
  diffRef?: string;
  lastDiffHash?: string;
  lastDiffSet?: DiffSet;
  hasNewChanges: boolean;
}

const sessions = new Map<string, Session>();

// Track which WS clients are viewing which session
const clientSessions = new Map<WebSocket, string>();

// Session watcher intervals for live diff polling
const sessionWatchers = new Map<string, NodeJS.Timeout>();
let serverPollInterval = 2000;

// Module-level callback set by startGlobalServer to reopen browser when needed
let reopenBrowserIfNeeded: (() => void) | null = null;

function toSummary(session: Session): SessionSummary {
  const { payload } = session;
  const fileCount = payload.diffSet.files.length;
  let additions = 0;
  let deletions = 0;
  for (const file of payload.diffSet.files) {
    additions += file.additions;
    deletions += file.deletions;
  }

  return {
    id: session.id,
    projectPath: session.projectPath,
    branch: payload.metadata.currentBranch,
    title: payload.metadata.title,
    fileCount,
    additions,
    deletions,
    status: session.status,
    decision: session.result?.decision,
    createdAt: session.createdAt,
    hasNewChanges: session.hasNewChanges,
  };
}

// ─── JSON body parser ───

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ─── Route matching ───

function matchRoute(
  method: string,
  url: string,
  expectedMethod: string,
  pattern: string,
): Record<string, string> | null {
  if (method !== expectedMethod) return null;

  const patternParts = pattern.split("/");
  const urlParts = url.split("/");

  if (patternParts.length !== urlParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

// ─── WebSocket broadcast ───

let wss: WebSocketServer | null = null;

function broadcastToAll(msg: ServerMessage): void {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function sendToSessionClients(sessionId: string, msg: ServerMessage): void {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const [client, sid] of clientSessions.entries()) {
    if (sid === sessionId && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// ─── Session watcher management ───

function hasViewersForSession(sessionId: string): boolean {
  for (const [client, sid] of clientSessions.entries()) {
    if (sid === sessionId && client.readyState === WebSocket.OPEN) {
      return true;
    }
  }
  return false;
}

function startSessionWatcher(sessionId: string): void {
  if (sessionWatchers.has(sessionId)) return;

  const session = sessions.get(sessionId);
  if (!session?.diffRef) return;

  const interval = setInterval(() => {
    const s = sessions.get(sessionId);
    if (!s?.diffRef) {
      stopSessionWatcher(sessionId);
      return;
    }

    try {
      const { diffSet: newDiffSet, rawDiff: newRawDiff } = getDiff(s.diffRef, {
        cwd: s.projectPath,
      });
      const newHash = hashDiff(newRawDiff);

      if (newHash !== s.lastDiffHash) {
        const newBriefing = analyze(newDiffSet);
        const changedFiles = detectChangedFiles(s.lastDiffSet ?? null, newDiffSet);

        // Update session payload
        s.payload = {
          ...s.payload,
          diffSet: newDiffSet,
          rawDiff: newRawDiff,
          briefing: newBriefing,
        };
        s.lastDiffHash = newHash;
        s.lastDiffSet = newDiffSet;

        if (hasViewersForSession(sessionId)) {
          // Send live update to active viewers
          sendToSessionClients(sessionId, {
            type: "diff:update",
            payload: {
              diffSet: newDiffSet,
              rawDiff: newRawDiff,
              briefing: newBriefing,
              changedFiles,
              timestamp: Date.now(),
            },
          });
          s.hasNewChanges = false;
        } else {
          // Mark as having new changes for session list indicator
          s.hasNewChanges = true;
          broadcastSessionList();
        }
      }
    } catch {
      // getDiff can fail if git state is mid-operation — silently skip
    }
  }, serverPollInterval);

  sessionWatchers.set(sessionId, interval);
}

function stopSessionWatcher(sessionId: string): void {
  const interval = sessionWatchers.get(sessionId);
  if (interval) {
    clearInterval(interval);
    sessionWatchers.delete(sessionId);
  }
}

function startAllWatchers(): void {
  for (const [id, session] of sessions.entries()) {
    if (session.diffRef && !sessionWatchers.has(id)) {
      startSessionWatcher(id);
    }
  }
}

function stopAllWatchers(): void {
  for (const [id, interval] of sessionWatchers.entries()) {
    clearInterval(interval);
  }
  sessionWatchers.clear();
}

function hasConnectedClients(): boolean {
  if (!wss) return false;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

function broadcastSessionList(): void {
  const summaries = Array.from(sessions.values()).map(toSummary);
  broadcastToAll({ type: "session:list", payload: summaries });
}

// ─── API route handler ───

async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const url = (req.url ?? "/").split("?")[0];

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Only handle /api/* routes
  if (!url.startsWith("/api/")) {
    return false;
  }

  // GET /api/status
  if (method === "GET" && url === "/api/status") {
    jsonResponse(res, 200, {
      running: true,
      pid: process.pid,
      sessions: sessions.size,
      uptime: process.uptime(),
    });
    return true;
  }

  // POST /api/reviews — create a new session
  if (method === "POST" && url === "/api/reviews") {
    try {
      const body = await readBody(req);
      const { payload, projectPath, diffRef } = JSON.parse(body) as {
        payload: ReviewInitPayload;
        projectPath: string;
        diffRef?: string;
      };

      const sessionId = `session-${randomUUID().slice(0, 8)}`;
      payload.reviewId = sessionId;

      // Set watchMode when diffRef is provided so the UI knows live updates are possible
      if (diffRef) {
        payload.watchMode = true;
      }

      const session: Session = {
        id: sessionId,
        payload,
        projectPath,
        status: "pending",
        createdAt: Date.now(),
        result: null,
        diffRef,
        lastDiffHash: diffRef ? hashDiff(payload.rawDiff) : undefined,
        lastDiffSet: diffRef ? payload.diffSet : undefined,
        hasNewChanges: false,
      };

      sessions.set(sessionId, session);

      // Start watcher if clients are connected and diffRef is provided
      if (diffRef && hasConnectedClients()) {
        startSessionWatcher(sessionId);
      }

      // Notify connected UI clients about the new session
      broadcastToAll({
        type: "session:added",
        payload: toSummary(session),
      });

      // Re-open browser if no UI clients are connected
      reopenBrowserIfNeeded?.();

      jsonResponse(res, 201, { sessionId });
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
    }
    return true;
  }

  // GET /api/reviews — list all sessions
  if (method === "GET" && url === "/api/reviews") {
    const summaries = Array.from(sessions.values()).map(toSummary);
    jsonResponse(res, 200, { sessions: summaries });
    return true;
  }

  // GET /api/reviews/:id
  const getReviewParams = matchRoute(method, url, "GET", "/api/reviews/:id");
  if (getReviewParams) {
    const session = sessions.get(getReviewParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }
    jsonResponse(res, 200, toSummary(session));
    return true;
  }

  // POST /api/reviews/:id/result — UI submits review result
  const postResultParams = matchRoute(method, url, "POST", "/api/reviews/:id/result");
  if (postResultParams) {
    const session = sessions.get(postResultParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    try {
      const body = await readBody(req);
      const result = JSON.parse(body) as ReviewResult;
      session.result = result;
      session.status = "submitted";

      broadcastToAll({ type: "session:updated", payload: toSummary(session) });

      jsonResponse(res, 200, { ok: true });
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
    }
    return true;
  }

  // GET /api/reviews/:id/result — MCP polls for result
  const getResultParams = matchRoute(method, url, "GET", "/api/reviews/:id/result");
  if (getResultParams) {
    const session = sessions.get(getResultParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    if (session.result) {
      jsonResponse(res, 200, { result: session.result, status: "submitted" });
    } else {
      jsonResponse(res, 200, { result: null, status: session.status });
    }
    return true;
  }

  // POST /api/reviews/:id/context — update reasoning/context
  const postContextParams = matchRoute(method, url, "POST", "/api/reviews/:id/context");
  if (postContextParams) {
    const session = sessions.get(postContextParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    try {
      const body = await readBody(req);
      const contextPayload = JSON.parse(body) as ContextUpdatePayload;

      // Update session metadata
      if (contextPayload.reasoning !== undefined) {
        session.payload.metadata.reasoning = contextPayload.reasoning;
      }
      if (contextPayload.title !== undefined) {
        session.payload.metadata.title = contextPayload.title;
      }
      if (contextPayload.description !== undefined) {
        session.payload.metadata.description = contextPayload.description;
      }

      // Forward to UI clients watching this session
      sendToSessionClients(session.id, {
        type: "context:update",
        payload: contextPayload,
      });

      jsonResponse(res, 200, { ok: true });
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
    }
    return true;
  }

  // DELETE /api/reviews/:id — remove a session
  const deleteParams = matchRoute(method, url, "DELETE", "/api/reviews/:id");
  if (deleteParams) {
    stopSessionWatcher(deleteParams.id);
    if (sessions.delete(deleteParams.id)) {
      jsonResponse(res, 200, { ok: true });
    } else {
      jsonResponse(res, 404, { error: "Session not found" });
    }
    return true;
  }

  jsonResponse(res, 404, { error: "Not found" });
  return true;
}

// ─── Main entry point ───

export async function startGlobalServer(
  options: GlobalServerOptions = {},
): Promise<GlobalServerHandle> {
  const {
    httpPort: preferredHttpPort = 24680,
    wsPort: preferredWsPort = 24681,
    silent = false,
    dev = false,
    pollInterval = 2000,
  } = options;

  serverPollInterval = pollInterval;

  // Get available ports (prefer defaults, fall back to random)
  const [httpPort, wsPort] = await Promise.all([
    getPort({ port: preferredHttpPort }),
    getPort({ port: preferredWsPort }),
  ]);

  // Start UI server on a separate port
  let uiPort: number;
  let uiHttpServer: http.Server | null = null;
  let viteServer: { close: () => Promise<void> } | null = null;

  if (dev) {
    uiPort = await getPort();
    const uiRoot = resolveUiRoot();
    viteServer = await startViteDevServer(uiRoot, uiPort, silent);
  } else {
    uiPort = await getPort();
    const uiDist = resolveUiDist();
    uiHttpServer = await createStaticServer(uiDist, uiPort);
  }

  // Create the HTTP API server
  const httpServer = http.createServer(async (req, res) => {
    const handled = await handleApiRequest(req, res);
    if (!handled) {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  // Create WebSocket server on a separate port
  wss = new WebSocketServer({ port: wsPort });

  wss.on("connection", (ws, req) => {
    // Start all watchers when first client connects
    startAllWatchers();

    // Parse session ID from query string: ws://localhost:PORT?sessionId=xyz
    const url = new URL(req.url ?? "/", `http://localhost:${wsPort}`);
    const sessionId = url.searchParams.get("sessionId");

    if (sessionId) {
      clientSessions.set(ws, sessionId);

      // Send the review:init payload for this session
      const session = sessions.get(sessionId);
      if (session) {
        session.status = "in_review";
        session.hasNewChanges = false;
        broadcastToAll({ type: "session:updated", payload: toSummary(session) });
        const msg: ServerMessage = {
          type: "review:init",
          payload: session.payload,
        };
        ws.send(JSON.stringify(msg));
      }
    } else {
      // No specific session requested — send full session list (server mode UI)
      const summaries = Array.from(sessions.values()).map(toSummary);
      const msg: ServerMessage = {
        type: "session:list",
        payload: summaries,
      };
      ws.send(JSON.stringify(msg));

      // Auto-select if there's exactly one session
      if (summaries.length === 1) {
        const session = sessions.get(summaries[0].id);
        if (session) {
          clientSessions.set(ws, session.id);
          session.status = "in_review";
          session.hasNewChanges = false;
          broadcastToAll({ type: "session:updated", payload: toSummary(session) });
          ws.send(JSON.stringify({
            type: "review:init",
            payload: session.payload,
          } satisfies ServerMessage));
        }
      }
    }

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        if (msg.type === "review:submit") {
          const sid = clientSessions.get(ws);
          if (sid) {
            const session = sessions.get(sid);
            if (session) {
              session.result = msg.payload;
              session.status = "submitted";
              broadcastToAll({ type: "session:updated", payload: toSummary(session) });
            }
          }
        } else if (msg.type === "session:select") {
          const session = sessions.get(msg.payload.sessionId);
          if (session) {
            clientSessions.set(ws, session.id);
            session.status = "in_review";
            session.hasNewChanges = false;
            startSessionWatcher(session.id);
            broadcastToAll({ type: "session:updated", payload: toSummary(session) });
            ws.send(JSON.stringify({
              type: "review:init",
              payload: session.payload,
            } satisfies ServerMessage));
          }
        } else if (msg.type === "session:close") {
          const closedId = msg.payload.sessionId;
          stopSessionWatcher(closedId);
          sessions.delete(closedId);
          // Remove any client associations with this session
          for (const [client, sid] of clientSessions.entries()) {
            if (sid === closedId) {
              clientSessions.delete(client);
            }
          }
          broadcastSessionList();
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      clientSessions.delete(ws);

      // Stop all watchers when no clients remain
      if (!hasConnectedClients()) {
        stopAllWatchers();
      }
    });
  });

  // Start the HTTP server
  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(httpPort, () => resolve());
  });

  // Write server discovery file
  const serverInfo: GlobalServerInfo = {
    httpPort,
    wsPort,
    pid: process.pid,
    startedAt: Date.now(),
  };
  writeServerFile(serverInfo);

  if (!silent) {
    console.log(`\nDiffPrism Global Server`);
    console.log(`  API:  http://localhost:${httpPort}`);
    console.log(`  WS:   ws://localhost:${wsPort}`);
    console.log(`  UI:   http://localhost:${uiPort}`);
    console.log(`  PID:  ${process.pid}`);
    console.log(`\nWaiting for reviews...\n`);
  }

  // Open browser to UI
  const uiUrl = `http://localhost:${uiPort}?wsPort=${wsPort}&serverMode=true`;
  await open(uiUrl);

  // Re-open browser when a review arrives and no UI clients are connected
  reopenBrowserIfNeeded = (): void => {
    if (!hasConnectedClients()) {
      open(uiUrl);
    }
  };

  async function stop(): Promise<void> {
    // Stop all session watchers
    stopAllWatchers();

    // Close all WebSocket connections
    if (wss) {
      for (const client of wss.clients) {
        client.close();
      }
      wss.close();
      wss = null;
    }
    clientSessions.clear();
    sessions.clear();
    reopenBrowserIfNeeded = null;

    // Close HTTP server
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    // Close UI server
    if (viteServer) {
      await viteServer.close();
    }
    if (uiHttpServer) {
      uiHttpServer.close();
    }

    // Remove discovery file
    removeServerFile();
  }

  return { httpPort, wsPort, stop };
}
