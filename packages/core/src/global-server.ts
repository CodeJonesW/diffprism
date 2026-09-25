import http from "node:http";
import { randomUUID } from "node:crypto";
import getPort from "get-port";
import open from "open";
import { WebSocketServer, WebSocket } from "ws";

import { getDiff, listBranches, listCommits, getCurrentBranch, getRepoRoot, getGitHubRemotes } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";

import fs from "node:fs";
import path from "node:path";

import type {
  GlobalServerOptions,
  GlobalServerHandle,
  GlobalServerInfo,
  PrAgentHandle,
  PrAgentStarter,
  SessionSummary,
  GlobalSessionStatus,
  SessionSource,
  ReviewInitPayload,
  ReviewResult,
  ContextUpdatePayload,
  ServerMessage,
  ClientMessage,
  DiffSet,
  Annotation,
  AnnotationType,
  AnnotationCategory,
  AnnotationSource,
  AnnotationReply,
  ThreadAuthor,
  DiffSide,
  PrReviewSubmission,
} from "./types.js";
import { dojoThreadBody } from "./dojo.js";
import type { DojoRunner, DojoState } from "./dojo.js";
import { writeServerFile, removeServerFile } from "./server-file.js";
import { awaitingAgent, pickedUpByAgent } from "./threads.js";
import { builtAt, getBuildInfo } from "./build-info.js";
import { recordError } from "./feedback.js";
import {
  REVIEW_AGENTS,
  isReviewAgent,
  readAgentSettings,
  writeAgentSettings,
  chooseReviewAgent,
} from "./agent-settings.js";
import type { AgentSettings, ReviewAgentChoice, ReviewAgentName } from "./agent-settings.js";
import {
  resolveUiDist,
  resolveUiRoot,
  startViteDevServer,
  createStaticServer,
} from "./ui-server.js";
import { hashDiff, detectChangedFiles } from "./diff-utils.js";
import { DEFAULT_DIFF_REF } from "./diff-scope.js";
import { buildFeedbackUrl, readLastError, currentVersion } from "./feedback.js";
import { buildGitHubReview, PR_EVENT_DECISION } from "./pr-review.js";
import { watcherPollDelay, DEFAULT_WATCH_SCHEDULE } from "./watch-schedule.js";
import type { WatchScheduleOptions } from "./watch-schedule.js";
import { createDiffPoller } from "./diff-poller.js";
import type { DiffPoller } from "./diff-poller.js";
import { appendHistory, generateEntryId, getRecentHistory } from "./review-history.js";
import type { ReviewHistoryEntry } from "./review-history.js";

// ─── TTL constants ───

const SUBMITTED_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ABANDONED_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const IDLE_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── In-memory session store ───

interface UserFocus {
  file: string | null;
  lineStart?: number;
  lineEnd?: number;
  updatedAt: number;
}

interface Session {
  id: string;
  /**
   * What this session is a review OF. "repo:<working tree root>" for local
   * changes, "pr:<owner>/<repo>#<n>" for a pull request. Every open path
   * dedups on this and nothing else — see openSession.
   */
  key: string;
  /**
   * The local working tree this session reads from, or null for a PR with no
   * local clone. Participant tools find a session by repo path through this
   * (and a PR review also through the clone's GitHub remotes — see /resolve).
   */
  repoRoot: string | null;
  payload: ReviewInitPayload;
  projectPath: string;
  source: SessionSource;
  status: GlobalSessionStatus;
  result: ReviewResult | null;
  createdAt: number;
  diffRef?: string;
  lastDiffHash?: string;
  lastDiffSet?: DiffSet;
  hasNewChanges: boolean;
  annotations: Annotation[];
  /** The review dojo on this PR review, once one has been started (#231). */
  dojo?: DojoState;
  userFocus?: UserFocus;
  /**
   * Set when the user closes the session in the UI. A closed session is kept
   * in memory — a blocked caller (CLI review, pre-commit hook, MCP) is still
   * polling for its "dismissed" verdict and would otherwise hang until its
   * timeout — but it is never listed again, so it does not come back when the
   * UI reconnects. Cleared if a new review reuses the session.
   */
  closedAt?: number;
  /**
   * Warnings created after this moment are unseen and put the session in
   * needsAttention. Advanced when someone selects the session, or when a
   * warning lands while it is already being viewed.
   */
  attentionClearedAt: number;
  /**
   * Hash of the diff the current verdict was given on. A verdict answers a
   * specific diff, so re-opening the review with that same diff keeps it.
   */
  verdictDiffHash?: string;
  /**
   * The ref the session was opened with. Comparing against another ref
   * overwrites diffRef, so without this "reset" had nothing to go back to and
   * guessed the working copy — the wrong diff for a staged commit-gate review.
   */
  openedDiffRef?: string;
  /**
   * Last time anyone did anything with this session: opened or reused it,
   * viewed it, waited on its result, annotated or decided it, or its diff
   * changed. A session idle past the TTL with nobody viewing is expired, so
   * an abandoned one stops polling git.
   */
  lastActivityAt: number;
  /** See SessionSummary.agentReadAt. */
  agentReadAt?: number;
}

function touch(session: Session): void {
  session.lastActivityAt = Date.now();
}

/**
 * An agent just read this session's threads. Viewers are only told when the
 * read reached a reviewer message no agent had seen yet — waiting agents read
 * every 2s, and a broadcast per read would be noise.
 */
function recordAgentRead(session: Session): void {
  const previous = session.agentReadAt;
  session.agentReadAt = Date.now();
  touch(session);
  if (session.annotations.some((a) => awaitingAgent(a) && !pickedUpByAgent(a, previous))) {
    broadcastSessionUpdate(session);
  }
}

const sessions = new Map<string, Session>();

/**
 * Summaries of the sessions a UI should show. Every path that lists sessions
 * goes through here; they used to each call sessions.values() directly, and
 * that is how a closed session kept reappearing.
 */
function listedSummaries(): SessionSummary[] {
  return Array.from(sessions.values())
    .filter((session) => session.closedAt === undefined)
    .map(toSummary);
}

// ─── Session identity ───

/**
 * The identity of a local review: one session per repo, not per repo+ref.
 *
 * Keyed on the working tree's top level, so an agent running from a
 * subdirectory and a hook firing at the root land on the same session, while
 * a linked worktree — which has its own top level — gets its own. Outside a
 * git repository there is no top level to normalise to, so the resolved path
 * itself is the identity.
 */
function localIdentity(projectPath: string): { key: string; repoRoot: string } {
  const repoRoot = getRepoRoot({ cwd: projectPath }) ?? path.resolve(projectPath);
  return { key: `repo:${repoRoot}`, repoRoot };
}

function findSessionByKey(key: string): Session | undefined {
  for (const session of sessions.values()) {
    if (session.key === key) return session;
  }
  return undefined;
}

interface OpenSessionRequest {
  key: string;
  repoRoot: string | null;
  projectPath: string;
  payload: ReviewInitPayload;
  diffRef?: string;
  source: SessionSource;
}

/**
 * The clone of `owner/repo` that `from` is inside, as its working tree root —
 * not `from` itself, which may be a subfolder — or null when it isn't in one.
 * A clone is recognized by its GitHub remotes.
 */
function localCloneOf(owner: string, repo: string, from: string): string | null {
  const root = getRepoRoot({ cwd: from });
  if (!root) return null;
  return getGitHubRemotes({ cwd: root }).includes(`${owner}/${repo}`.toLowerCase()) ? root : null;
}

/**
 * The one way a session is created or reused.
 *
 * The CLI, the pre-commit hook, MCP open_review, "Open Project" and "Review PR"
 * all come through here. They used to build sessions separately with opposite
 * rules — agent opens deduped and overwrote in place, manual opens never
 * deduped — so a hook could silently hijack a UI-opened session for the same
 * repo, or leave two live-watching sessions side by side.
 */
function openSession(request: OpenSessionRequest): { session: Session; reused: boolean } {
  const { payload, diffRef } = request;
  if (diffRef) {
    payload.watchMode = true;
  }

  const existing = findSessionByKey(request.key);

  if (!existing) {
    const id = `session-${randomUUID().slice(0, 8)}`;
    payload.reviewId = id;
    const session: Session = {
      id,
      key: request.key,
      repoRoot: request.repoRoot,
      payload,
      projectPath: request.projectPath,
      source: request.source,
      status: "pending",
      createdAt: Date.now(),
      result: null,
      diffRef,
      openedDiffRef: diffRef,
      lastDiffHash: diffRef ? hashDiff(payload.rawDiff) : undefined,
      lastDiffSet: diffRef ? payload.diffSet : undefined,
      hasNewChanges: false,
      annotations: [],
      attentionClearedAt: 0,
      lastActivityAt: Date.now(),
    };
    sessions.set(id, session);
    if (diffRef) {
      startSessionWatcher(id);
    }
    broadcastToAll({ type: "session:added", payload: toSummary(session) });
    return { session, reused: false };
  }

  const id = existing.id;
  payload.reviewId = id;
  stopSessionWatcher(id);

  const wasClosed = existing.closedAt !== undefined;
  existing.closedAt = undefined;

  const incomingHash = hashDiff(payload.rawDiff);
  const contentChanged = hashDiff(existing.payload.rawDiff) !== incomingHash;

  // A verdict answers a specific diff. If the same diff comes back, so does
  // the verdict: a caller that re-opens because its wait was cut off — an
  // agent whose `git commit` hit its shell timeout mid-review, or whose
  // open_review returned timed_out — picks up the decision the reviewer
  // already gave instead of wiping it and asking them again. A changed diff
  // is a new question and needs a new decision. Dismissal is not a verdict on
  // the diff, only "not now", so it never carries over.
  const stillAnswered =
    existing.result !== null &&
    existing.result.decision !== "dismissed" &&
    existing.verdictDiffHash === incomingHash;

  if (existing.result !== null && !stillAnswered) {
    existing.result = null;
    existing.status = "pending";
    existing.verdictDiffHash = undefined;
  }
  // A round still in progress keeps its status — resetting an in_review
  // session would pull it out from under the person reviewing it.

  existing.payload = payload;
  existing.projectPath = request.projectPath;
  existing.repoRoot = request.repoRoot;
  // Ref-on-reuse: the freshest thing someone asked to look at wins.
  existing.diffRef = diffRef;
  existing.openedDiffRef = diffRef;
  existing.lastDiffHash = diffRef ? incomingHash : undefined;
  existing.lastDiffSet = diffRef ? payload.diffSet : undefined;
  existing.createdAt = Date.now();
  touch(existing);
  // Annotations are deliberately kept. Reuse used to wipe them, destroying an
  // agent's findings whenever a hook or a second open landed on the repo.

  if (diffRef) {
    startSessionWatcher(id);
  }

  if (hasViewersForSession(id)) {
    if (existing.status === "pending") {
      existing.status = "in_review";
    }
    existing.hasNewChanges = false;
    sendToSessionClients(id, { type: "review:init", payload });
    // review:init resets the viewer's annotations, so the ones kept above have
    // to be sent again — otherwise "preserved" is only true on the server.
    for (const annotation of existing.annotations) {
      sendToSessionClients(id, { type: "annotation:added", payload: annotation });
    }
  } else if (contentChanged || wasClosed) {
    // Only a real change is news. A retry of the identical diff — the case the
    // kept verdict above exists for — should not light up the sidebar.
    existing.hasNewChanges = true;
  }

  // The UI dropped a closed session and ignores updates for ids it does not
  // hold, so a reopened one has to be announced as new.
  if (wasClosed) {
    broadcastToAll({ type: "session:added", payload: toSummary(existing) });
  } else {
    broadcastSessionUpdate(existing);
  }

  return { session: existing, reused: true };
}

/**
 * A client starts viewing a session. Connecting with ?sessionId=, the
 * handshake's auto-select, and session:select all do this; they used to each
 * hand-copy the steps and had drifted — only session:select acknowledged
 * attention or started the watcher.
 */
function attachViewer(ws: WebSocket, session: Session): void {
  clientSessions.set(ws, session.id);
  session.status = "in_review";
  session.hasNewChanges = false;
  session.attentionClearedAt = Date.now();
  touch(session);

  const watcher = sessionWatchers.get(session.id);
  startSessionWatcher(session.id);
  broadcastSessionUpdate(session);

  ws.send(JSON.stringify({ type: "review:init", payload: session.payload } satisfies ServerMessage));
  for (const annotation of session.annotations) {
    ws.send(JSON.stringify({ type: "annotation:added", payload: annotation } satisfies ServerMessage));
  }
  if (session.dojo) {
    ws.send(JSON.stringify({ type: "dojo:update", payload: session.dojo } satisfies ServerMessage));
  }

  // An unviewed watcher may have backed off to minutes between polls, so the
  // diff just sent could be stale. Poll now; a change reaches this viewer as
  // diff:update. (A watcher started just above already read the diff.)
  watcher?.wake();
}

/** Unseen, undismissed warnings — what the sidebar flags for attention. */
function needsAttention(session: Session): boolean {
  return session.annotations.some(
    (a) => a.type === "warning" && !a.dismissed && a.createdAt > session.attentionClearedAt,
  );
}

// Track which WS clients are viewing which session
const clientSessions = new Map<WebSocket, string>();

// Session watchers using DiffPoller for live diff polling
const sessionWatchers = new Map<string, DiffPoller>();
let watchSchedule: WatchScheduleOptions = DEFAULT_WATCH_SCHEDULE;

// Module-level callback set by startGlobalServer to reopen browser when needed
let reopenBrowserIfNeeded: (() => void) | null = null;

/** Covers a dashboard's reconnect loop (one attempt a second) with room to spare. */
const DASHBOARD_RECONNECT_GRACE_MS = 3000;

// Module-level UI URL for /api/status
let serverUiUrl: string | null = null;

/** Runs review dojos; set from GlobalServerOptions.dojo. */
let dojoRunner: DojoRunner | null = null;

/** Why a dojo can't start on this session, or null when it can. */
function dojoRefusal(session: Session, agents: ReviewAgentChoice[]): string | null {
  if (!session.payload.metadata.githubPr) return "A review dojo runs on a pull request review.";
  if (session.dojo?.status === "running") return "A dojo is already running on this review.";
  if (agents.length === 0) return "Choose at least one agent.";
  if (new Set(agents.map((a) => a.name)).size !== agents.length) return "Each agent can take part once.";
  return null;
}

function setDojo(session: Session, dojo: DojoState): void {
  session.dojo = dojo;
  touch(session);
  sendToSessionClients(session.id, { type: "dojo:update", payload: dojo });
}

/**
 * Run a dojo on a PR review (#231) and, when it's done, post each combined
 * finding as a thread on its line, so the reviewer can answer it there.
 */
function startDojo(session: Session, runner: DojoRunner, server: GlobalServerInfo, agents: ReviewAgentChoice[]): DojoState {
  const pr = session.payload.metadata.githubPr!;
  const started: DojoState = { status: "running", agents: [], findings: [], startedAt: Date.now() };
  setDojo(session, started);

  runner
    .run({ sessionId: session.id, prUrl: pr.url, localRepoPath: session.repoRoot, server, agents })
    .then(
      (result) => {
        // Closed or replaced while the agents worked: nobody is left to show it to.
        if (sessions.get(session.id) !== session || session.dojo !== started) return;
        const labels = Object.fromEntries(result.agents.map((a) => [a.agent.name, a.label]));
        const findings = result.findings.map((finding) => {
          const annotation = addAnnotation(session, {
            file: finding.file,
            line: finding.line,
            side: finding.side,
            body: dojoThreadBody(finding, labels),
            type: "finding",
            category: "other",
            source: { agent: "Review dojo", tool: "dojo" },
            author: "agent",
          });
          return { ...finding, annotationId: annotation.id };
        });
        setDojo(session, { ...started, status: "done", agents: result.agents, findings, finishedAt: Date.now() });
      },
      (err: unknown) => {
        recordError("dojo", err);
        if (sessions.get(session.id) !== session || session.dojo !== started) return;
        const error = err instanceof Error ? err.message : String(err);
        setDojo(session, { ...started, status: "failed", error, finishedAt: Date.now() });
      },
    );
  return started;
}

/** Starts an agent for a PR review; set from GlobalServerOptions.prAgent. */
let prAgentStarter: PrAgentStarter | null = null;
/** This server, as agents need it to reach the reviews they answer. */
let runningServer: GlobalServerInfo | null = null;
/**
 * The agent answering each PR review, by session id — one per review. Held
 * while it is still starting, too, so a PR opened twice in quick succession
 * doesn't start two.
 */
const prAgents = new Map<string, Promise<PrAgentHandle>>();

/**
 * The agent answering this PR review, starting one if none is (#224). Every
 * way of opening a PR review comes through here, so the dashboard's Review PR
 * form gets an agent just as `diffprism review <PR>` does. Reopening the same
 * PR finds the agent already answering it rather than starting a second.
 */
function ensurePrAgent(
  sessionId: string,
  prUrl: string,
  localRepoPath: string | null,
  agent: ReviewAgentChoice,
): Promise<PrAgentHandle | null> {
  const existing = prAgents.get(sessionId);
  if (existing) return existing;
  // A server given no way to start agents (tests, or an embedding) has none.
  if (!prAgentStarter || !runningServer) return Promise.resolve(null);

  const starting = prAgentStarter({ sessionId, prUrl, localRepoPath, server: runningServer, agent });
  prAgents.set(sessionId, starting);
  // Once it stops, or if it never started, reopening the PR starts a fresh one.
  const forget = (): void => {
    if (prAgents.get(sessionId) === starting) prAgents.delete(sessionId);
  };
  starting.then((handle) => handle.done.then(forget, forget), forget);
  return starting;
}

/** Open a thread on a session and tell whoever needs to know. */
function addAnnotation(
  session: Session,
  fields: Pick<Annotation, "file" | "line" | "side" | "body" | "type" | "source" | "author"> &
    Partial<Pick<Annotation, "confidence" | "category">>,
): Annotation {
  const annotation: Annotation = {
    id: randomUUID(),
    sessionId: session.id,
    ...fields,
    confidence: fields.confidence ?? 1,
    category: fields.category ?? "other",
    createdAt: Date.now(),
    replies: [],
  };

  session.annotations.push(annotation);
  touch(session);

  // Broadcast to UI clients viewing this session
  sendToSessionClients(session.id, {
    type: "annotation:added",
    payload: annotation,
  });

  if (annotation.type === "warning") {
    // Someone already looking at the session has seen it.
    if (hasViewersForSession(session.id)) {
      session.attentionClearedAt = annotation.createdAt;
    }
    // Everyone else learns through the sidebar. annotation:added only
    // reaches viewers of this session, so relying on it meant a warning on
    // a session you were NOT looking at could never raise attention.
    broadcastSessionUpdate(session);
  }
  return annotation;
}

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
    reasoning: payload.metadata.reasoning,
    fileCount,
    additions,
    deletions,
    status: session.status,
    decision: session.result?.decision,
    createdAt: session.createdAt,
    hasNewChanges: session.hasNewChanges,
    needsAttention: needsAttention(session),
    diffRef: session.diffRef,
    source: session.source,
    agentReadAt: session.agentReadAt,
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

function broadcastSessionUpdate(session: Session): void {
  broadcastToAll({
    type: "session:updated",
    payload: toSummary(session),
  });
}

function broadcastSessionRemoved(sessionId: string): void {
  // Clean up clientSessions entries for the removed session
  for (const [client, sid] of clientSessions.entries()) {
    if (sid === sessionId) {
      clientSessions.delete(client);
    }
  }
  broadcastToAll({
    type: "session:removed",
    payload: { sessionId },
  });
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

  const poller = createDiffPoller({
    diffRef: session.diffRef,
    cwd: session.projectPath,
    // Asked before every poll, so a session speeds up the moment someone views
    // it and backs off while nobody is — see watch-schedule.ts.
    pollInterval: ({ quietPolls }) =>
      watcherPollDelay({ viewed: hasViewersForSession(sessionId), quietPolls }, watchSchedule),
    onDiffChanged: (updatePayload) => {
      const s = sessions.get(sessionId);
      if (!s) return;
      touch(s);

      // Update session payload
      s.payload = {
        ...s.payload,
        diffSet: updatePayload.diffSet,
        rawDiff: updatePayload.rawDiff,
        briefing: updatePayload.briefing,
      };
      s.lastDiffHash = hashDiff(updatePayload.rawDiff);
      s.lastDiffSet = updatePayload.diffSet;

      if (hasViewersForSession(sessionId)) {
        sendToSessionClients(sessionId, {
          type: "diff:update",
          payload: updatePayload,
        });
        s.hasNewChanges = false;
      } else {
        s.hasNewChanges = true;
        broadcastSessionList();
      }
    },
  });

  poller.start();
  sessionWatchers.set(sessionId, poller);
}

function stopSessionWatcher(sessionId: string): void {
  const poller = sessionWatchers.get(sessionId);
  if (poller) {
    poller.stop();
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
  for (const [, poller] of sessionWatchers.entries()) {
    poller.stop();
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
  const summaries = listedSummaries();
  broadcastToAll({ type: "session:list", payload: summaries });
}

/** Record a reviewer's decision, noting which diff it was a decision about. */
function recordVerdict(session: Session, result: ReviewResult): void {
  session.result = result;
  session.status = "submitted";
  session.verdictDiffHash = hashDiff(session.payload.rawDiff);
  touch(session);
  recordReviewHistory(session, result);
}

function recordReviewHistory(session: Session, result: ReviewResult): void {
  // Skip history for non-filesystem paths (e.g. github: prefixed paths)
  if (session.projectPath.startsWith("github:")) return;

  try {
    const { payload } = session;
    const entry: ReviewHistoryEntry = {
      id: generateEntryId(),
      timestamp: Date.now(),
      diffRef: session.diffRef ?? "unknown",
      decision: result.decision,
      filesReviewed: payload.diffSet.files.length,
      additions: payload.diffSet.files.reduce((sum, f) => sum + f.additions, 0),
      deletions: payload.diffSet.files.reduce((sum, f) => sum + f.deletions, 0),
      commentCount: result.comments.length,
      branch: payload.metadata.currentBranch,
      title: payload.metadata.title,
      summary: result.summary ?? payload.briefing.summary,
    };
    appendHistory(session.projectPath, entry);
  } catch {
    // History recording is best-effort — don't fail the review
  }
}

// ─── Helpers ───

function isInsideGitRepo(dirPath: string): boolean {
  let current = dirPath;
  while (current !== "/") {
    if (fs.existsSync(`${current}/.git`)) return true;
    const parent = current.replace(/\/[^/]+$/, "") || "/";
    if (parent === current) break;
    current = parent;
  }
  return fs.existsSync(`${current}/.git`);
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
      uiUrl: serverUiUrl,
      cwd: process.cwd(),
      // The dashboard reads its default scope from here rather than keeping
      // its own copy — Vite can't import @diffprism/core, and a copy drifts.
      defaultDiffRef: DEFAULT_DIFF_REF,
    });
    return true;
  }

  // GET /api/feedback?kind=feedback|bug — a prefilled GitHub issue URL
  //
  // Built here because the UI can't import core. Nothing is sent: the dashboard
  // links to the URL and the user submits the issue themselves, if at all.
  if (method === "GET" && url === "/api/feedback") {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const kind = parsed.searchParams.get("kind") === "bug" ? "bug" : "feedback";
    jsonResponse(res, 200, {
      url: buildFeedbackUrl({ kind, error: kind === "bug" ? readLastError() : null }),
    });
    return true;
  }

  // POST /api/reviews — open (or reuse) a local review session
  if (method === "POST" && url === "/api/reviews") {
    try {
      const body = await readBody(req);
      const { payload, projectPath, diffRef } = JSON.parse(body) as {
        payload: ReviewInitPayload;
        projectPath: string;
        diffRef?: string;
      };

      const identity = localIdentity(projectPath);
      const { session, reused } = openSession({
        key: identity.key,
        repoRoot: identity.repoRoot,
        projectPath: identity.repoRoot,
        payload,
        diffRef,
        source: "agent",
      });

      // Re-open browser if no UI clients are connected
      reopenBrowserIfNeeded?.();

      jsonResponse(res, reused ? 200 : 201, { sessionId: session.id });
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
    }
    return true;
  }

  // POST /api/projects/open — open a project directory as a manual session
  if (method === "POST" && url === "/api/projects/open") {
    try {
      const body = await readBody(req);
      const { projectPath, diffRef = DEFAULT_DIFF_REF } = JSON.parse(body) as {
        projectPath: string;
        diffRef?: string;
      };

      if (!projectPath) {
        jsonResponse(res, 400, { error: "Missing projectPath" });
        return true;
      }

      // Validate path exists and is a directory
      try {
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory()) {
          jsonResponse(res, 400, { error: "Path is not a directory" });
          return true;
        }
      } catch {
        jsonResponse(res, 400, { error: "Path does not exist" });
        return true;
      }

      // Compute diff (throws if not a git repo)
      let diffResult;
      try {
        diffResult = getDiff(diffRef, { cwd: projectPath });
      } catch (err) {
        jsonResponse(res, 400, {
          error: err instanceof Error ? err.message : "Not a git repository",
        });
        return true;
      }

      const { diffSet, rawDiff } = diffResult;
      const briefing = analyze(diffSet);
      let currentBranch: string | undefined;
      try {
        currentBranch = getCurrentBranch({ cwd: projectPath });
      } catch {
        // Not critical
      }

      const identity = localIdentity(projectPath);
      const projectName = identity.repoRoot.split("/").pop() || identity.repoRoot;

      const payload: ReviewInitPayload = {
        reviewId: "",
        diffSet,
        rawDiff,
        briefing,
        metadata: {
          title: projectName,
          currentBranch,
        },
      };

      const { session, reused } = openSession({
        key: identity.key,
        repoRoot: identity.repoRoot,
        projectPath: identity.repoRoot,
        payload,
        diffRef,
        source: "manual",
      });

      jsonResponse(res, reused ? 200 : 201, {
        sessionId: session.id,
        fileCount: diffSet.files.length,
      });
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
    }
    return true;
  }

  // POST /api/pr/open — open a GitHub PR as a review session
  if (method === "POST" && url === "/api/pr/open") {
    try {
      const body = await readBody(req);
      const { prUrl, cwd, title, reasoning, agent } = JSON.parse(body) as {
        prUrl: string;
        cwd?: string;
        title?: string;
        reasoning?: string;
        /**
         * False to open the review without starting an agent (`--no-agent`);
         * an agent and model for this review (`--agent`, `--model`, #226);
         * true or absent for the saved default.
         */
        agent?: boolean | { name?: string; model?: string };
      };

      if (typeof agent === "object" && agent !== null && agent.name !== undefined && !isReviewAgent(agent.name)) {
        jsonResponse(res, 400, { error: `Unknown agent "${agent.name}"; it must be one of ${REVIEW_AGENTS.join(", ")}.` });
        return true;
      }

      if (!prUrl) {
        jsonResponse(res, 400, { error: "Missing prUrl" });
        return true;
      }

      // Dynamic import to keep core lightweight
      const {
        isPrRef,
        parsePrRef,
        resolveGitHubToken,
        createGitHubClient,
        fetchPullRequest,
        fetchPullRequestDiff,
        normalizePr,
      } = await import("@diffprism/github");

      if (!isPrRef(prUrl)) {
        jsonResponse(res, 400, {
          error: "Invalid PR URL. Expected https://github.com/owner/repo/pull/123 or owner/repo#123",
        });
        return true;
      }

      let token: string;
      try {
        token = resolveGitHubToken();
      } catch (err) {
        jsonResponse(res, 401, {
          error: err instanceof Error ? err.message : "GitHub token not found",
        });
        return true;
      }

      const { owner, repo, number: prNumber } = parsePrRef(prUrl);
      const client = createGitHubClient(token);

      const [prMetadata, rawDiff] = await Promise.all([
        fetchPullRequest(client, owner, repo, prNumber),
        fetchPullRequestDiff(client, owner, repo, prNumber),
      ]);

      // What the caller said this review is about wins over the PR's own title.
      const normalized = normalizePr(rawDiff, prMetadata, { title, reasoning });

      // Read from the clone the request came from: `diffprism review <PR>`
      // sends the folder it ran in. The dashboard's form has no folder, so it
      // gets the server's — a clone only if the daemon happened to start in
      // one. Looking only there made every CLI review report "no local clone"
      // (#197). Agents in any clone still find the session: see /resolve.
      const localRepoPath = localCloneOf(owner, repo, cwd ?? process.cwd());

      // A PR is its own review subject, keyed by the PR — not by the local
      // clone it may be read from. Keying it by repo would make a PR review
      // and a working-copy review of the same repo overwrite each other.
      const { session, reused } = openSession({
        key: `pr:${owner}/${repo}#${prNumber}`.toLowerCase(),
        repoRoot: localRepoPath,
        projectPath: localRepoPath ?? `github:${owner}/${repo}#${prNumber}`,
        payload: normalized.payload,
        source: "manual",
      });

      // Same as a local review: with no dashboard open, open one. Without it,
      // `diffprism review <PR>` started a review nobody could see (#223). The
      // dashboard's own Review PR form is a connected client, so it opens
      // nothing extra.
      reopenBrowserIfNeeded?.();

      // Asked not to start one, this still reports an agent that is already
      // answering the review — it's there either way. Settings that can't be
      // read don't stop the review opening; they stop the agent, and say why.
      // One still starting, or already answering. If it failed to start, that
      // was reported to whoever asked then; this asks again below.
      let prAgent: PrAgentHandle | null = (await prAgents.get(session.id)?.catch(() => null)) ?? null;
      let agentError: string | undefined;
      if (agent !== false && !prAgent) {
        try {
          const asked = typeof agent === "object" && agent !== null ? agent : {};
          const choice = chooseReviewAgent(readAgentSettings(), {
            name: asked.name as ReviewAgentName | undefined,
            model: asked.model,
          });
          prAgent = await ensurePrAgent(session.id, prMetadata.url, localRepoPath, choice);
        } catch (err) {
          agentError = err instanceof Error ? err.message : String(err);
          recordError("pr agent", err);
        }
      }

      jsonResponse(res, reused ? 200 : 201, {
        sessionId: session.id,
        fileCount: normalized.diffSet.files.length,
        localRepoPath,
        agent: prAgent
          ? {
              name: prAgent.agent.name,
              model: prAgent.agent.model ?? null,
              label: prAgent.label,
              conversationId: prAgent.conversationId,
              cwd: prAgent.cwd,
              resumeCommand: prAgent.resumeCommand,
            }
          : null,
        ...(agentError ? { agentError } : {}),
        pr: {
          title: prMetadata.title,
          author: prMetadata.author,
          url: prMetadata.url,
          baseBranch: prMetadata.baseBranch,
          headBranch: prMetadata.headBranch,
        },
      });
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : "Failed to fetch PR",
      });
    }
    return true;
  }

  // GET /api/fs/list?path=<dir> — list directory contents for the path picker
  if (method === "GET" && req.url) {
    const parsedUrl = new URL(req.url, "http://localhost");
    if (parsedUrl.pathname === "/api/fs/list") {
      const dirPath = parsedUrl.searchParams.get("path") || process.cwd();

      try {
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
          jsonResponse(res, 400, { error: "Not a directory" });
          return true;
        }
      } catch {
        jsonResponse(res, 400, { error: "Path does not exist" });
        return true;
      }

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const dirs: Array<{ name: string; path: string; isGitRepo: boolean }> = [];

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue; // skip hidden dirs
          const fullPath = `${dirPath}/${entry.name}`;
          const isGitRepo = fs.existsSync(`${fullPath}/.git`);
          dirs.push({ name: entry.name, path: fullPath, isGitRepo });
        }

        // Sort: git repos first, then alphabetical
        dirs.sort((a, b) => {
          if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        // Check if current dir is or is inside a git repo
        const isGitRepo = isInsideGitRepo(dirPath);
        const parentPath = dirPath === "/" ? null : dirPath.replace(/\/[^/]+$/, "") || "/";

        jsonResponse(res, 200, { path: dirPath, parentPath, isGitRepo, dirs });
      } catch {
        jsonResponse(res, 500, { error: "Failed to list directory" });
      }
      return true;
    }
  }

  // GET /api/settings/agent — which agent answers PR reviews, and with which model (#226)
  if (method === "GET" && url === "/api/settings/agent") {
    try {
      jsonResponse(res, 200, { settings: readAgentSettings(), agents: REVIEW_AGENTS });
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // PUT /api/settings/agent — save the default agent and models. Applies to
  // the next agent started; ones already answering keep going as they are.
  if (method === "PUT" && url === "/api/settings/agent") {
    try {
      const body = JSON.parse(await readBody(req)) as { agent?: unknown; models?: unknown };
      if (!isReviewAgent(body.agent)) {
        jsonResponse(res, 400, { error: `agent must be one of ${REVIEW_AGENTS.join(", ")}.` });
        return true;
      }
      const models = (body.models ?? {}) as Record<string, unknown>;
      if (typeof models !== "object" || Object.entries(models).some(([k, v]) => !isReviewAgent(k) || typeof v !== "string")) {
        jsonResponse(res, 400, { error: `models maps each of ${REVIEW_AGENTS.join(", ")} to a model name.` });
        return true;
      }
      const saved = writeAgentSettings({ agent: body.agent, models: models as AgentSettings["models"] });
      jsonResponse(res, 200, { settings: saved });
    } catch (err) {
      jsonResponse(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // GET /api/dojo/agents — the agents a review dojo can seat here (#231)
  if (method === "GET" && url === "/api/dojo/agents") {
    if (!dojoRunner) {
      jsonResponse(res, 404, { error: "This server can't run a review dojo." });
      return true;
    }
    try {
      jsonResponse(res, 200, { agents: await dojoRunner.available() });
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // POST /api/reviews/:id/dojo — start a review dojo with these agents (#231).
  // Each agent's model comes from the saved settings.
  const dojoParams = matchRoute(method, url, "POST", "/api/reviews/:id/dojo");
  if (dojoParams) {
    const session = sessions.get(dojoParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }
    if (!dojoRunner || !runningServer) {
      jsonResponse(res, 404, { error: "This server can't run a review dojo." });
      return true;
    }
    try {
      const { agents: names } = JSON.parse(await readBody(req)) as { agents?: unknown };
      if (!Array.isArray(names) || !names.every(isReviewAgent)) {
        jsonResponse(res, 400, { error: `agents must be a list of ${REVIEW_AGENTS.join(", ")}.` });
        return true;
      }
      const settings = readAgentSettings();
      const agents = (names as ReviewAgentName[]).map((name) => chooseReviewAgent(settings, { name }));
      const refusal = dojoRefusal(session, agents);
      if (refusal) {
        jsonResponse(res, 409, { error: refusal });
        return true;
      }
      jsonResponse(res, 202, { dojo: startDojo(session, dojoRunner, runningServer, agents) });
    } catch (err) {
      jsonResponse(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // GET /api/reviews — list all sessions
  if (method === "GET" && url === "/api/reviews") {
    const summaries = listedSummaries();
    jsonResponse(res, 200, { sessions: summaries });
    return true;
  }

  // GET /api/reviews/resolve?path=<dir> — sessions for a repo path
  //
  // How participant tools find "the session for this repo" without guessing.
  // Returns every open session whose working tree matches, plus every PR
  // review of a GitHub repo this clone has as a remote — a PR opened from the
  // dashboard has no working tree, and an agent in the clone still has to
  // find it. The caller decides what zero, one, or several matches mean.
  // Must precede /api/reviews/:id.
  if (method === "GET" && url === "/api/reviews/resolve") {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const rawPath = parsed.searchParams.get("path");
    if (!rawPath) {
      jsonResponse(res, 400, { error: "Missing path" });
      return true;
    }

    const repoRoot = getRepoRoot({ cwd: rawPath }) ?? path.resolve(rawPath);
    const remotes = getGitHubRemotes({ cwd: repoRoot });
    const matches = Array.from(sessions.values())
      .filter((session) => {
        if (session.closedAt !== undefined) return false;
        if (session.repoRoot === repoRoot) return true;
        const pr = session.payload.metadata.githubPr;
        return pr !== undefined && remotes.includes(`${pr.owner}/${pr.repo}`.toLowerCase());
      })
      .map(toSummary);

    jsonResponse(res, 200, { repoRoot, sessions: matches });
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

  // GET /api/reviews/:id/payload — full session data (diffSet, briefing, metadata)
  const getPayloadParams = matchRoute(method, url, "GET", "/api/reviews/:id/payload");
  if (getPayloadParams) {
    const session = sessions.get(getPayloadParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }
    jsonResponse(res, 200, {
      payload: session.payload,
      projectPath: session.projectPath,
      annotations: session.annotations,
    });
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
      recordVerdict(session, result);
      if (result.decision === "dismissed") {
        broadcastSessionRemoved(postResultParams.id);
      } else {
        broadcastSessionUpdate(session);
      }

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
    // A caller blocked on this review polls here; that keeps it alive.
    touch(session);

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

  // POST /api/reviews/:id/annotations — add an annotation to a session
  const postAnnotationParams = matchRoute(method, url, "POST", "/api/reviews/:id/annotations");
  if (postAnnotationParams) {
    const session = sessions.get(postAnnotationParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    try {
      const body = await readBody(req);
      const { file, line, side, body: annotationBody, type, confidence, category, source, author } = JSON.parse(body) as {
        file: string;
        line: number;
        side?: DiffSide;
        body: string;
        type: AnnotationType;
        confidence?: number;
        category?: AnnotationCategory;
        source: AnnotationSource;
        author?: ThreadAuthor;
      };

      if (author !== undefined && author !== "agent" && author !== "reviewer") {
        jsonResponse(res, 400, { error: `Unknown author: ${String(author)}` });
        return true;
      }
      if (side !== undefined && side !== "old" && side !== "new") {
        jsonResponse(res, 400, { error: `Unknown side: ${String(side)}` });
        return true;
      }

      const annotation = addAnnotation(session, {
        file,
        line,
        // Agents annotate lines of the changed file; only the dashboard can
        // point at a deleted line, and it says so.
        side: side ?? "new",
        body: annotationBody,
        type,
        confidence,
        category,
        source,
        author: author ?? "agent",
      });

      jsonResponse(res, 200, { annotationId: annotation.id });
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
    }
    return true;
  }

  // GET /api/reviews/:id/annotations — list annotations for a session
  //
  // ?reader=agent marks the caller as an agent (the MCP tools, or a CLI/hook
  // caller blocked on the decision). That is how the dashboard knows a
  // reviewer's question reached an agent — and, when it didn't, says nothing
  // is listening instead of "waiting" forever.
  const getAnnotationsParams = matchRoute(method, url, "GET", "/api/reviews/:id/annotations");
  if (getAnnotationsParams) {
    const session = sessions.get(getAnnotationsParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    if (new URL(req.url ?? "/", "http://localhost").searchParams.get("reader") === "agent") {
      recordAgentRead(session);
    }

    jsonResponse(res, 200, { annotations: session.annotations });
    return true;
  }

  // POST /api/reviews/:id/annotations/:annotationId/replies — continue a thread
  //
  // Either side can reply. The reviewer writes from the dashboard; an agent
  // answers through the MCP `reply` tool, having found the thread with
  // `wait_for_comments`.
  const replyParams = matchRoute(method, url, "POST", "/api/reviews/:id/annotations/:annotationId/replies");
  if (replyParams) {
    const session = sessions.get(replyParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }
    const annotation = session.annotations.find((a) => a.id === replyParams.annotationId);
    if (!annotation) {
      jsonResponse(res, 404, { error: "Annotation not found" });
      return true;
    }

    try {
      const { author, agent, body: replyBody } = JSON.parse(await readBody(req)) as {
        author?: ThreadAuthor;
        agent?: string;
        body?: string;
      };

      if (author !== "agent" && author !== "reviewer") {
        jsonResponse(res, 400, { error: "author must be \"agent\" or \"reviewer\"" });
        return true;
      }
      if (!replyBody?.trim()) {
        jsonResponse(res, 400, { error: "A reply needs a body" });
        return true;
      }

      const reply: AnnotationReply = {
        id: randomUUID(),
        author,
        ...(author === "agent" ? { agent: agent ?? "unknown" } : {}),
        body: replyBody,
        createdAt: Date.now(),
      };
      annotation.replies = [...(annotation.replies ?? []), reply];
      touch(session);

      sendToSessionClients(session.id, { type: "annotation:updated", payload: annotation });
      jsonResponse(res, 200, { replyId: reply.id, annotation });
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
    }
    return true;
  }

  // POST /api/reviews/:id/github-review — post the reviewer's decision on a PR to GitHub
  const githubReviewParams = matchRoute(method, url, "POST", "/api/reviews/:id/github-review");
  if (githubReviewParams) {
    const session = sessions.get(githubReviewParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }
    const pr = session.payload.metadata.githubPr;
    if (!pr) {
      jsonResponse(res, 400, { error: "Not a pull request review" });
      return true;
    }

    let submission: PrReviewSubmission;
    try {
      submission = JSON.parse(await readBody(req)) as PrReviewSubmission;
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
      return true;
    }

    const built = buildGitHubReview(submission, session.annotations);
    if ("error" in built) {
      jsonResponse(res, 400, { error: built.error });
      return true;
    }

    const { resolveGitHubToken, createGitHubClient, submitGitHubReview } = await import("@diffprism/github");
    let token: string;
    try {
      token = resolveGitHubToken();
    } catch (err) {
      jsonResponse(res, 401, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }

    let posted: { url: string };
    try {
      posted = await submitGitHubReview(createGitHubClient(token), pr.owner, pr.repo, pr.number, built.review);
    } catch (err) {
      // Nothing is recorded: the review only counts once GitHub has it.
      jsonResponse(res, 502, {
        error: `GitHub rejected the review: ${err instanceof Error ? err.message : String(err)}`,
      });
      return true;
    }

    recordVerdict(session, {
      decision: PR_EVENT_DECISION[built.review.event],
      comments: [],
      summary: built.review.body || undefined,
    });
    broadcastSessionUpdate(session);
    jsonResponse(res, 200, { url: posted.url });
    return true;
  }

  // POST /api/reviews/:id/annotations/:annotationId/dismiss — dismiss an annotation
  const dismissAnnotationParams = matchRoute(method, url, "POST", "/api/reviews/:id/annotations/:annotationId/dismiss");
  if (dismissAnnotationParams) {
    const session = sessions.get(dismissAnnotationParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    const annotation = session.annotations.find((a) => a.id === dismissAnnotationParams.annotationId);
    if (!annotation) {
      jsonResponse(res, 404, { error: "Annotation not found" });
      return true;
    }

    annotation.dismissed = true;

    // Broadcast to UI clients viewing this session
    sendToSessionClients(dismissAnnotationParams.id, {
      type: "annotation:dismissed",
      payload: { annotationId: dismissAnnotationParams.annotationId },
    });

    if (annotation.type === "warning") {
      broadcastSessionUpdate(session);
    }

    jsonResponse(res, 200, { ok: true });
    return true;
  }

  // POST /api/reviews/:id/focus — update user focus state
  const postFocusParams = matchRoute(method, url, "POST", "/api/reviews/:id/focus");
  if (postFocusParams) {
    const session = sessions.get(postFocusParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    try {
      const body = await readBody(req);
      const { file, lineStart, lineEnd } = JSON.parse(body) as {
        file: string | null;
        lineStart?: number;
        lineEnd?: number;
      };

      session.userFocus = {
        file,
        lineStart,
        lineEnd,
        updatedAt: Date.now(),
      };

      jsonResponse(res, 200, { ok: true });
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
    }
    return true;
  }

  // GET /api/reviews/:id/focus — get user focus state
  const getFocusParams = matchRoute(method, url, "GET", "/api/reviews/:id/focus");
  if (getFocusParams) {
    const session = sessions.get(getFocusParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    jsonResponse(res, 200, { focus: session.userFocus ?? null });
    return true;
  }

  // DELETE /api/reviews/:id — remove a session
  const deleteParams = matchRoute(method, url, "DELETE", "/api/reviews/:id");
  if (deleteParams) {
    stopSessionWatcher(deleteParams.id);
    if (sessions.delete(deleteParams.id)) {
      broadcastSessionRemoved(deleteParams.id);
      jsonResponse(res, 200, { ok: true });
    } else {
      jsonResponse(res, 404, { error: "Session not found" });
    }
    return true;
  }

  // GET /api/reviews/:id/refs — list branches and commits for a session's project
  const getRefsParams = matchRoute(method, url, "GET", "/api/reviews/:id/refs");
  if (getRefsParams) {
    const session = sessions.get(getRefsParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    // Ref listing requires a real filesystem path
    if (session.projectPath.startsWith("github:")) {
      jsonResponse(res, 400, { error: "Ref listing not available for GitHub PRs" });
      return true;
    }

    try {
      const branches = listBranches({ cwd: session.projectPath });
      const commits = listCommits({ cwd: session.projectPath });
      const currentBranch = getCurrentBranch({ cwd: session.projectPath });

      jsonResponse(res, 200, { branches, commits, currentBranch });
    } catch {
      jsonResponse(res, 500, { error: "Failed to list git refs" });
    }
    return true;
  }

  // POST /api/reviews/:id/compare — recompute diff against a different ref
  const postCompareParams = matchRoute(method, url, "POST", "/api/reviews/:id/compare");
  if (postCompareParams) {
    const session = sessions.get(postCompareParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    // Ref comparison requires a real filesystem path
    if (session.projectPath.startsWith("github:")) {
      jsonResponse(res, 400, { error: "Ref comparison not available for GitHub PRs" });
      return true;
    }

    try {
      const body = await readBody(req);
      const { ref: requestedRef, reset } = JSON.parse(body) as { ref?: string; reset?: boolean };

      // `reset` returns to the ref the session was opened with. The server
      // decides that, because it is the only place that still knows it.
      const ref = reset ? (session.openedDiffRef ?? DEFAULT_DIFF_REF) : requestedRef;
      if (!ref) {
        jsonResponse(res, 400, { error: "Missing ref in request body" });
        return true;
      }

      const { diffSet: newDiffSet, rawDiff: newRawDiff } = getDiff(ref, {
        cwd: session.projectPath,
      });
      const newBriefing = analyze(newDiffSet);
      const changedFiles = detectChangedFiles(session.lastDiffSet ?? null, newDiffSet);

      // Update session state
      session.payload = {
        ...session.payload,
        diffSet: newDiffSet,
        rawDiff: newRawDiff,
        briefing: newBriefing,
      };
      session.lastDiffHash = hashDiff(newRawDiff);
      session.lastDiffSet = newDiffSet;

      // Update diffRef and restart watcher with new ref
      stopSessionWatcher(session.id);
      session.diffRef = ref;
      touch(session);
      if (hasConnectedClients()) {
        startSessionWatcher(session.id);
      }

      // Push diff:update to connected UI clients
      sendToSessionClients(session.id, {
        type: "diff:update",
        payload: {
          diffSet: newDiffSet,
          rawDiff: newRawDiff,
          briefing: newBriefing,
          changedFiles,
          timestamp: Date.now(),
        },
      });

      jsonResponse(res, 200, { ok: true, fileCount: newDiffSet.files.length });
    } catch {
      jsonResponse(res, 400, { error: "Failed to compute diff for the given ref" });
    }
    return true;
  }

  // GET /api/reviews/:id/history — return review history for the session's project path
  const getSessionHistoryParams = matchRoute(method, url, "GET", "/api/reviews/:id/history");
  if (getSessionHistoryParams) {
    const session = sessions.get(getSessionHistoryParams.id);
    if (!session) {
      jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }

    // Skip history for non-filesystem paths (e.g. github: prefixed paths)
    if (session.projectPath.startsWith("github:")) {
      jsonResponse(res, 200, { history: [] });
      return true;
    }

    const history = getRecentHistory(session.projectPath);
    jsonResponse(res, 200, { history });
    return true;
  }

  // GET /api/history?project=<path> — return history for any project path (URL-encoded)
  if (method === "GET" && req.url) {
    const parsedUrl = new URL(req.url, "http://localhost");
    if (parsedUrl.pathname === "/api/history") {
      const projectPath = parsedUrl.searchParams.get("project");
      if (!projectPath) {
        jsonResponse(res, 400, { error: "Missing required query parameter: project" });
        return true;
      }

      // Skip history for non-filesystem paths (e.g. github: prefixed paths)
      if (projectPath.startsWith("github:")) {
        jsonResponse(res, 200, { history: [] });
        return true;
      }

      const history = getRecentHistory(projectPath);
      jsonResponse(res, 200, { history });
      return true;
    }
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
    uiPort: preferredUiPort = 24682,
    reconnectGraceMs = DASHBOARD_RECONNECT_GRACE_MS,
    silent = false,
    dev = false,
    pollInterval = DEFAULT_WATCH_SCHEDULE.viewedMs,
    unviewedPollInterval = DEFAULT_WATCH_SCHEDULE.unviewedMs,
    unviewedPollMaxInterval = DEFAULT_WATCH_SCHEDULE.unviewedMaxMs,
    idleSessionTtl = IDLE_SESSION_TTL_MS,
    cleanupInterval = CLEANUP_INTERVAL_MS,
    openBrowser = true,
    prAgent,
    dojo,
  } = options;
  prAgentStarter = prAgent ?? null;
  dojoRunner = dojo ?? null;

  watchSchedule = {
    viewedMs: pollInterval,
    unviewedMs: unviewedPollInterval,
    unviewedMaxMs: unviewedPollMaxInterval,
  };

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
    uiPort = await getPort({ port: preferredUiPort });
    const uiRoot = resolveUiRoot();
    viteServer = await startViteDevServer(uiRoot, uiPort, silent);
  } else {
    uiPort = await getPort({ port: preferredUiPort });
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
      const session = sessions.get(sessionId);
      if (session) {
        attachViewer(ws, session);
      } else {
        clientSessions.set(ws, sessionId);
      }
    } else {
      // No specific session requested — send full session list (server mode UI)
      const summaries = listedSummaries();
      const msg: ServerMessage = {
        type: "session:list",
        payload: summaries,
      };
      ws.send(JSON.stringify(msg));

      // Auto-select if there's exactly one session
      if (summaries.length === 1) {
        const session = sessions.get(summaries[0].id);
        if (session) {
          attachViewer(ws, session);
        }
      }
    }

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        // Verdicts come over HTTP (POST /api/reviews/:id/result), which answers:
        // a WebSocket message had no reply, so one that went nowhere looked sent (#203).
        if (msg.type === "session:select") {
          const session = sessions.get(msg.payload.sessionId);
          if (session) {
            attachViewer(ws, session);
          }
        } else if (msg.type === "session:close") {
          const closedId = msg.payload.sessionId;
          stopSessionWatcher(closedId);
          const closedSession = sessions.get(closedId);
          if (closedSession) {
            closedSession.closedAt = Date.now();
            if (!closedSession.result) {
              // Store dismiss result so MCP polling can pick it up
              closedSession.result = { decision: "dismissed", comments: [] };
              closedSession.status = "submitted";
            }
          }
          broadcastSessionRemoved(closedId);
        } else if (msg.type === "diff:change_ref") {
          const sid = clientSessions.get(ws);
          if (sid) {
            const session = sessions.get(sid);
            if (session) {
              const newRef = msg.payload.diffRef;
              try {
                const { diffSet: newDiffSet, rawDiff: newRawDiff } = getDiff(newRef, {
                  cwd: session.projectPath,
                });
                const newBriefing = analyze(newDiffSet);

                // Update session
                session.payload = {
                  ...session.payload,
                  diffSet: newDiffSet,
                  rawDiff: newRawDiff,
                  briefing: newBriefing,
                };
                session.diffRef = newRef;
                session.lastDiffHash = hashDiff(newRawDiff);
                session.lastDiffSet = newDiffSet;

                // Restart watcher with new ref
                stopSessionWatcher(sid);
                startSessionWatcher(sid);

                // Send update to client
                sendToSessionClients(sid, {
                  type: "diff:update",
                  payload: {
                    diffSet: newDiffSet,
                    rawDiff: newRawDiff,
                    briefing: newBriefing,
                    changedFiles: newDiffSet.files.map((f) => f.path),
                    timestamp: Date.now(),
                  },
                });
              } catch (err) {
                const errorMsg: ServerMessage = {
                  type: "diff:error",
                  payload: {
                    error: err instanceof Error ? err.message : String(err),
                  },
                };
                ws.send(JSON.stringify(errorMsg));
              }
            }
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      clientSessions.delete(ws);
      // Watchers keep running even when no UI clients are connected —
      // the server is the source of truth, not the browser.
    });
  });

  // Start the HTTP server
  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(httpPort, () => resolve());
  });

  // TTL cleanup interval
  function cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      // Idle: nobody viewing it, nobody waiting on it, nothing changing. This
      // is what finally stops an abandoned session polling git. It used to be
      // impossible for two kinds — a UI-opened session was only ever removed
      // by an explicit close, and an in_review session matched no rule at all.
      const idle =
        session.status !== "submitted" &&
        !hasViewersForSession(id) &&
        now - session.lastActivityAt > idleSessionTtl;

      // The age-based rules still don't apply to an open UI session: a
      // person opened it, so an hour without a verdict isn't abandonment.
      const age = now - session.createdAt;
      const ageRulesApply = !(session.source === "manual" && session.status !== "submitted");
      const expiredByAge =
        ageRulesApply &&
        ((session.status === "submitted" && age > SUBMITTED_TTL_MS) ||
          (session.status === "pending" && age > ABANDONED_TTL_MS));

      if (idle || expiredByAge) {
        stopSessionWatcher(id);
        sessions.delete(id);
        broadcastSessionRemoved(id);
      }
    }
  }
  const cleanupTimer = setInterval(cleanupExpiredSessions, cleanupInterval);

  // Write server discovery file
  const serverInfo: GlobalServerInfo = {
    httpPort,
    wsPort,
    pid: process.pid,
    startedAt: Date.now(),
    // Which build this is, so `diffprism doctor` can say what is serving reviews.
    version: currentVersion(),
  };
  const build = getBuildInfo();
  if (build.root) {
    serverInfo.devRoot = build.root;
  }
  const serverBuiltAt = builtAt();
  if (serverBuiltAt !== null) {
    serverInfo.builtAt = serverBuiltAt;
  }
  writeServerFile(serverInfo);
  runningServer = serverInfo;

  if (!silent) {
    console.log(`\nDiffPrism Global Server`);
    console.log(`  API:  http://localhost:${httpPort}`);
    console.log(`  WS:   ws://localhost:${wsPort}`);
    console.log(`  UI:   http://localhost:${uiPort}`);
    console.log(`  PID:  ${process.pid}`);
    console.log(`\nWaiting for reviews...\n`);
  }

  // Open browser to UI
  const uiUrl = `http://localhost:${uiPort}?wsPort=${wsPort}&httpPort=${httpPort}&serverMode=true`;
  serverUiUrl = uiUrl;
  if (openBrowser) {
    await open(uiUrl);
  }

  // Re-open browser when a review arrives and no UI clients are connected.
  //
  // Right after this server starts — often because the command that is now
  // sending a review just replaced an older one — an already-open dashboard
  // is still reconnecting. Deciding "nobody is watching" before it has had
  // the chance opened a new tab on every restart.
  const serverStartedAt = Date.now();
  const pendingOpens = new Set<ReturnType<typeof setTimeout>>();
  reopenBrowserIfNeeded = (): void => {
    const openIfUnwatched = (): void => {
      if (reopenBrowserIfNeeded && !hasConnectedClients()) {
        open(uiUrl);
      }
    };
    const wait = serverStartedAt + reconnectGraceMs - Date.now();
    if (wait > 0) {
      const timer = setTimeout(() => {
        pendingOpens.delete(timer);
        openIfUnwatched();
      }, wait);
      pendingOpens.add(timer);
    } else {
      openIfUnwatched();
    }
  };

  async function stop(): Promise<void> {
    clearInterval(cleanupTimer);
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
    // A stopped server must not open a tab later — least of all for whichever
    // server starts next in this process.
    for (const timer of pendingOpens) clearTimeout(timer);
    pendingOpens.clear();
    reopenBrowserIfNeeded = null;
    prAgentStarter = null;
    dojoRunner = null;
    runningServer = null;
    prAgents.clear();
    serverUiUrl = null;

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
