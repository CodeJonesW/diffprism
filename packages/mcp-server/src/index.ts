import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ensureServer,
  submitReviewToServer,
  isServerAlive,
  ReviewTimeoutError,
} from "@diffprism/core";
import type {
  ContextUpdatePayload,
  GlobalServerInfo,
  ReviewResult,
  SessionSummary,
} from "@diffprism/core";
import { getDiff } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";
import { isPrRef } from "@diffprism/github";

declare const DIFFPRISM_VERSION: string;

/**
 * How long open_review waits for a decision unless told otherwise.
 *
 * Ten minutes, so that open_review — not the client — decides when the wait
 * ends. Claude Code aborts a stdio tool call that sends nothing for its idle
 * window (30 minutes by default), and a per-server `timeout` is a hard limit
 * people commonly set to ten minutes. If the client cuts the call off, the
 * agent gets a bare error with no session id and tends to fill the gap by
 * asking the user something; if we end it, the agent gets `timed_out` with the
 * session id and instructions to keep waiting (#161).
 */
export const DEFAULT_WAIT_MS = 600_000;

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const NO_SERVER =
  "No DiffPrism server is running. A review has to be open before this tool can act on it — open one with open_review, `diffprism review`, or the DiffPrism dashboard.";

function jsonResult(value: unknown): McpToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(text: string): McpToolResult {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Session targeting ───

interface TargetParams {
  session_id?: string;
  repo_path?: string;
}

const targetParams = {
  session_id: z
    .string()
    .optional()
    .describe("The review session to act on. Takes precedence over repo_path."),
  repo_path: z
    .string()
    .optional()
    .describe(
      "Any directory inside the repository whose review to act on. Defaults to the directory this agent is running in — pass it when working on a repo other than your own.",
    ),
};

type Target = { sessionId: string } | { error: string };

/**
 * Which session a tool acts on — decided, never guessed.
 *
 * Precedence: session_id, then repo_path, then the directory this agent runs
 * in. Reviews are one per repo, so a repo path almost always resolves to
 * exactly one session. When it resolves to none, or to several (a PR review
 * and a working-copy review can share a clone), this names the candidates and
 * stops. Falling back to "the most recent session across all repos" is how an
 * agent working in one repo used to post its findings into another.
 */
export async function resolveTarget(
  serverInfo: GlobalServerInfo,
  params: TargetParams,
): Promise<Target> {
  if (params.session_id) {
    return { sessionId: params.session_id };
  }

  const lookupPath = params.repo_path ?? process.cwd();
  const response = await fetch(
    `http://localhost:${serverInfo.httpPort}/api/reviews/resolve?path=${encodeURIComponent(lookupPath)}`,
  );
  if (!response.ok) {
    return { error: `Could not look up a review for ${lookupPath}: server returned ${response.status}.` };
  }

  const { repoRoot, sessions } = (await response.json()) as {
    repoRoot: string;
    sessions: SessionSummary[];
  };

  if (sessions.length === 1) {
    return { sessionId: sessions[0].id };
  }

  const from = params.repo_path ? "repo_path" : "the current directory";
  if (sessions.length === 0) {
    return {
      error: `No review is open for ${repoRoot} (resolved from ${from}). Open one with open_review, \`diffprism review\`, or the DiffPrism dashboard — or pass session_id.`,
    };
  }

  const candidates = sessions
    .map((s) => `  ${s.id}  ${s.title ?? "(untitled)"}  (${[s.diffRef, s.status].filter(Boolean).join(", ")})`)
    .join("\n");
  return {
    error: `${sessions.length} reviews are open for ${repoRoot}. Pass session_id to choose one:\n${candidates}`,
  };
}

/** Run a tool body against the resolved session, with the shared failure handling. */
async function withSession(
  params: TargetParams,
  run: (ctx: { serverInfo: GlobalServerInfo; sessionId: string }) => Promise<McpToolResult>,
): Promise<McpToolResult> {
  try {
    const serverInfo = await isServerAlive();
    if (!serverInfo) {
      return toolError(NO_SERVER);
    }
    const target = await resolveTarget(serverInfo, params);
    if ("error" in target) {
      return toolError(target.error);
    }
    return await run({ serverInfo, sessionId: target.sessionId });
  } catch (err) {
    return toolError(`Error: ${errorMessage(err)}`);
  }
}

const annotationSchema = z.object({
  file: z.string().describe("File path within the diff"),
  line: z
    .number()
    .optional()
    .describe("Line number to attach to (defaults to 1, for a note about the file as a whole)"),
  body: z.string().describe("The finding, suggestion, or question"),
  type: z
    .enum(["finding", "suggestion", "question", "warning"])
    .describe("Use 'warning' for anything the reviewer must look at — warnings flag the session for attention"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Confidence in the finding (0-1, defaults to 1)"),
  category: z
    .enum([
      "security",
      "performance",
      "convention",
      "correctness",
      "complexity",
      "test-coverage",
      "documentation",
      "other",
    ])
    .optional()
    .describe("Category of the finding (defaults to 'other')"),
});

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "diffprism",
    version: typeof DIFFPRISM_VERSION !== "undefined" ? DIFFPRISM_VERSION : "0.0.0-dev",
  });

  // ─── Opening a review ───

  server.tool(
    "open_review",
    "Open a review of local git changes in the DiffPrism dashboard and wait for the reviewer's decision. Blocks until they approve, request changes, or dismiss, then returns their ReviewResult (decision, inline comments, summary). Reviews are one per repo: opening again for the same repo updates the review already open instead of starting another, and keeps its annotations. Pass wait: false to get the session id back immediately instead. Pull requests are not opened here — open them with `diffprism review <PR URL>` or the dashboard, then use the PR tools.",
    {
      diff_ref: z
        .string()
        .describe(
          'What to review: "working-copy" (staged and unstaged, grouped), "staged", "unstaged", or a ref range like "HEAD~3..HEAD"',
        ),
      title: z.string().optional().describe("Title for the review"),
      description: z.string().optional().describe("Description of the changes"),
      reasoning: z
        .string()
        .optional()
        .describe(
          "Summarize what you were trying to accomplish in plain English. Shown as the session subtitle in the dashboard — the main way a reviewer tells sessions apart. Always populate this.",
        ),
      annotations: z
        .array(annotationSchema)
        .optional()
        .describe("Findings to attach to the review when it opens"),
      wait: z
        .boolean()
        .optional()
        .describe(
          "Wait for the reviewer's decision (default true). With false, returns the session id at once; check for a decision later with get_review_result.",
        ),
      timeout_ms: z
        .number()
        .optional()
        .describe(
          `How long to wait for a decision (default ${DEFAULT_WAIT_MS}ms). If it runs out the review stays open, and the session id comes back so you can check again with get_review_result.`,
        ),
    },
    async ({ diff_ref, title, description, reasoning, annotations, wait, timeout_ms }) => {
      if (isPrRef(diff_ref)) {
        return toolError(
          "open_review does not open pull requests. Open a PR review with `diffprism review <PR URL>` or the DiffPrism dashboard, then use get_pr_context, get_file_diff, get_file_context and annotate on that session.",
        );
      }

      try {
        const serverInfo = await ensureServer({ silent: true });
        const shouldWait = wait ?? true;

        try {
          const { result, sessionId } = await submitReviewToServer(serverInfo, diff_ref, {
            title,
            description,
            reasoning,
            cwd: process.cwd(),
            annotations: annotations?.map((a) => ({ ...a, line: a.line ?? 1 })),
            diffRef: diff_ref,
            timeoutMs: shouldWait ? (timeout_ms ?? DEFAULT_WAIT_MS) : 0,
          });

          if (result) {
            return jsonResult(result);
          }
          return jsonResult({
            status: "open",
            sessionId,
            message: "Review is open in the DiffPrism dashboard. Check for a decision with get_review_result.",
          });
        } catch (err) {
          if (err instanceof ReviewTimeoutError) {
            return jsonResult({
              status: "timed_out",
              sessionId: err.sessionId,
              message: `No decision after ${Math.round(err.waitedMs / 1000)}s. The reviewer may still be reading — the review is open in their browser. Wait with get_review_result (session_id: ${err.sessionId}, wait: true). Don't ask the user about it in the meantime: their decision is the answer. Calling open_review again with an unchanged diff is also safe — it returns a decision already given.`,
            });
          }
          throw err;
        }
      } catch (err) {
        return toolError(`Error: ${errorMessage(err)}`);
      }
    },
  );

  server.tool(
    "get_review_result",
    "Check the decision on a review that is already open — after open_review with wait: false, or after open_review timed out. Returns the ReviewResult once the reviewer has decided. Set wait: true to block until they do.",
    {
      ...targetParams,
      wait: z.boolean().optional().describe("Block until a decision arrives (up to timeout)"),
      timeout: z
        .number()
        .optional()
        .describe("Max wait in seconds when wait is true (default 300, max 600)"),
    },
    async ({ session_id, repo_path, wait, timeout }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const readResult = async (): Promise<ReviewResult | null> => {
          const response = await fetch(
            `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/result`,
          );
          if (!response.ok) {
            throw new Error(`Session not found: ${sessionId}`);
          }
          return ((await response.json()) as { result: ReviewResult | null }).result;
        };

        if (!wait) {
          const result = await readResult();
          return result
            ? jsonResult(result)
            : jsonResult({ status: "pending", sessionId, message: "No decision yet." });
        }

        const maxWaitMs = Math.min(timeout ?? 300, 600) * 1000;
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
          const result = await readResult();
          if (result) {
            return jsonResult(result);
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        return jsonResult({
          status: "pending",
          sessionId,
          message:
            "Still no decision; the review remains open in the reviewer's browser. Call get_review_result with wait: true again rather than asking the user — their decision is the answer.",
        });
      }),
  );

  server.tool(
    "update_review_context",
    "Push reasoning, title, or description to an open review without opening a new one. Returns immediately.",
    {
      ...targetParams,
      reasoning: z.string().optional().describe("Agent reasoning about the current changes"),
      title: z.string().optional().describe("Updated title for the review"),
      description: z.string().optional().describe("Updated description of the changes"),
    },
    async ({ session_id, repo_path, reasoning, title, description }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const payload: ContextUpdatePayload = {};
        if (reasoning !== undefined) payload.reasoning = reasoning;
        if (title !== undefined) payload.title = title;
        if (description !== undefined) payload.description = description;

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/context`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok) {
          return toolError(`Error updating review context: server returned ${response.status}`);
        }
        return jsonResult({ sessionId, updated: Object.keys(payload) });
      }),
  );

  // ─── Headless analysis ───

  server.tool(
    "get_diff",
    "Get a structured diff (DiffSet) for local git changes. Returns file-level and hunk-level change data as JSON without opening a browser. Use this to inspect what changed before deciding whether to open a full review.",
    {
      diff_ref: z
        .string()
        .describe(
          'Git diff reference: "staged", "unstaged", "working-copy" (staged+unstaged grouped), or a ref range like "HEAD~3..HEAD"',
        ),
    },
    async ({ diff_ref }) => {
      try {
        const { diffSet } = getDiff(diff_ref, { cwd: process.cwd() });
        return jsonResult(diffSet);
      } catch (err) {
        return toolError(`Error: ${errorMessage(err)}`);
      }
    },
  );

  server.tool(
    "analyze_diff",
    "Analyze local git changes and return a ReviewBriefing with summary, file triage (critical/notable/mechanical), impact detection (affected modules, tests, dependencies, breaking changes), complexity scores, test coverage gaps, and pattern flags (security issues, TODOs, console.logs). Same analysis shown in the DiffPrism briefing bar, but returned as JSON without opening a browser.",
    {
      diff_ref: z
        .string()
        .describe(
          'Git diff reference: "staged", "unstaged", "working-copy" (staged+unstaged grouped), or a ref range like "HEAD~3..HEAD"',
        ),
    },
    async ({ diff_ref }) => {
      try {
        const { diffSet } = getDiff(diff_ref, { cwd: process.cwd() });

        if (diffSet.files.length === 0) {
          return jsonResult({
            summary: "No changes to analyze.",
            triage: { critical: [], notable: [], mechanical: [] },
            impact: {
              affectedModules: [],
              affectedTests: [],
              publicApiChanges: false,
              breakingChanges: [],
              newDependencies: [],
            },
            verification: { testsPass: null, typeCheck: null, lintClean: null },
            fileStats: [],
          });
        }

        return jsonResult(analyze(diffSet));
      } catch (err) {
        return toolError(`Error: ${errorMessage(err)}`);
      }
    },
  );

  // ─── Participating in an open review ───

  server.tool(
    "annotate",
    "Post findings to an open review. They appear inline on the diff in the DiffPrism dashboard in real time. Use type 'warning' for anything the reviewer must look at — warnings flag the session in the sidebar. Accepts one or many findings.",
    {
      ...targetParams,
      annotations: z.array(annotationSchema).min(1).describe("One or more findings to post"),
      source_agent: z
        .string()
        .optional()
        .describe("Who is posting these, e.g. 'security-reviewer'"),
    },
    async ({ session_id, repo_path, annotations, source_agent }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const annotationIds: string[] = [];
        const failed: Array<{ file: string; line: number; error: string }> = [];

        for (const annotation of annotations) {
          const line = annotation.line ?? 1;
          const response = await fetch(
            `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/annotations`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                file: annotation.file,
                line,
                body: annotation.body,
                type: annotation.type,
                confidence: annotation.confidence ?? 1,
                category: annotation.category ?? "other",
                source: { agent: source_agent ?? "unknown", tool: "annotate" },
              }),
            },
          );

          if (response.ok) {
            annotationIds.push(((await response.json()) as { annotationId: string }).annotationId);
          } else {
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            failed.push({
              file: annotation.file,
              line,
              error: data.error ?? `Server returned ${response.status}`,
            });
          }
        }

        // Partial failure is reported, not swallowed: the old flag_for_attention
        // quietly counted only the flags that landed.
        const result = { sessionId, annotationIds, ...(failed.length > 0 ? { failed } : {}) };
        return annotationIds.length === 0 ? { ...jsonResult(result), isError: true } : jsonResult(result);
      }),
  );

  server.tool(
    "get_review_state",
    "Get the state of an open review: session summary (status, decision, whether it has new changes or needs attention) and all annotations.",
    { ...targetParams },
    async ({ session_id, repo_path }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const [sessionResponse, annotationsResponse] = await Promise.all([
          fetch(`http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}`),
          fetch(`http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/annotations`),
        ]);
        if (!sessionResponse.ok) {
          return toolError(`Session not found: ${sessionId}`);
        }
        const session = await sessionResponse.json();
        const { annotations } = annotationsResponse.ok
          ? ((await annotationsResponse.json()) as { annotations: unknown[] })
          : { annotations: [] };
        return jsonResult({ session, annotations });
      }),
  );

  server.tool(
    "get_review_comments",
    "Get every comment and annotation on an open review — findings from agents and inline comments from human reviewers. Read these before adding your own.",
    { ...targetParams },
    async ({ session_id, repo_path }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/annotations`,
        );
        if (!response.ok) {
          return toolError(`Session not found: ${sessionId}`);
        }
        const { annotations } = (await response.json()) as { annotations: unknown[] };
        return jsonResult({ sessionId, annotations });
      }),
  );

  server.tool(
    "get_user_focus",
    "Get what the reviewer is looking at right now in the DiffPrism dashboard — the selected file and any focused line range. Use this to answer questions about the code they are actively reviewing.",
    { ...targetParams },
    async ({ session_id, repo_path }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/focus`,
        );
        if (!response.ok) {
          return toolError(`Session not found: ${sessionId}`);
        }
        const data = (await response.json()) as {
          focus: { file: string | null; lineStart?: number; lineEnd?: number; updatedAt: number } | null;
        };
        return jsonResult({ sessionId, ...data });
      }),
  );

  // ─── Pull request review ───

  server.tool(
    "get_pr_context",
    "Get an overview of an open PR review: PR metadata (title, author, branches, URL), briefing summary, file list with stats, and the local repo path. Orient yourself with this before reading individual files. Open the PR review first with `diffprism review <PR URL>` or the dashboard.",
    { ...targetParams },
    async ({ session_id, repo_path }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/payload`,
        );
        if (!response.ok) {
          return toolError(`Session not found: ${sessionId}`);
        }

        const { payload, projectPath } = (await response.json()) as {
          payload: {
            diffSet: { files: Array<{ path: string; status: string; additions: number; deletions: number; language: string }> };
            briefing: { summary: string; triage: unknown };
            metadata: {
              title?: string;
              description?: string;
              githubPr?: { owner: string; repo: string; number: number; title: string; author: string; url: string; baseBranch: string; headBranch: string };
            };
          };
          projectPath: string;
        };

        return jsonResult({
          sessionId,
          projectPath,
          localRepoConnected: !projectPath.startsWith("github:"),
          pr: payload.metadata.githubPr ?? null,
          title: payload.metadata.title,
          description: payload.metadata.description,
          briefingSummary: payload.briefing.summary,
          triage: payload.briefing.triage,
          files: payload.diffSet.files.map((f) => ({
            path: f.path,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            language: f.language,
          })),
          totalFiles: payload.diffSet.files.length,
        });
      }),
  );

  server.tool(
    "get_file_diff",
    "Get the diff hunks for one file in an open review, with its triage category. Use this to work through a review one file at a time.",
    {
      file: z.string().describe("File path within the diff (e.g., 'src/index.ts')"),
      ...targetParams,
    },
    async ({ file, session_id, repo_path }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/payload`,
        );
        if (!response.ok) {
          return toolError(`Session not found: ${sessionId}`);
        }

        const data = (await response.json()) as {
          payload: {
            diffSet: { files: Array<{ path: string; status: string; additions: number; deletions: number; language: string; hunks: unknown[]; oldPath?: string }> };
            briefing: { triage: { critical: Array<{ file: string }>; notable: Array<{ file: string }>; mechanical: Array<{ file: string }> } };
          };
        };

        const diffFile = data.payload.diffSet.files.find((f) => f.path === file);
        if (!diffFile) {
          const available = data.payload.diffSet.files.map((f) => f.path);
          return toolError(`File not found in diff: "${file}". Available files:\n${available.join("\n")}`);
        }

        const { triage } = data.payload.briefing;
        let triageCategory = "mechanical";
        if (triage.critical.some((c) => c.file === file)) triageCategory = "critical";
        else if (triage.notable.some((n) => n.file === file)) triageCategory = "notable";

        return jsonResult({
          path: diffFile.path,
          oldPath: diffFile.oldPath,
          status: diffFile.status,
          language: diffFile.language,
          additions: diffFile.additions,
          deletions: diffFile.deletions,
          triageCategory,
          hunks: diffFile.hunks,
        });
      }),
  );

  server.tool(
    "get_file_context",
    "Get the full content of a file from the review's local repository, read with `git show` at the PR's head branch without switching branches. Needs the review to be connected to a local clone.",
    {
      file: z.string().describe("File path relative to repo root (e.g., 'src/index.ts')"),
      ref: z
        .string()
        .optional()
        .describe("Git ref to read from (e.g., 'origin/main', 'HEAD'). Defaults to the PR's head branch if available, otherwise HEAD."),
      ...targetParams,
    },
    async ({ file, ref, session_id, repo_path }) =>
      withSession({ session_id, repo_path }, async ({ serverInfo, sessionId }) => {
        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/payload`,
        );
        if (!response.ok) {
          return toolError(`Session not found: ${sessionId}`);
        }

        const data = (await response.json()) as {
          projectPath: string;
          payload: { metadata: { githubPr?: { headBranch: string } } };
        };

        if (data.projectPath.startsWith("github:")) {
          return toolError(
            "No local repo connected. Run the server from within a local clone of the repository to enable file context.",
          );
        }

        const gitRef =
          ref ??
          (data.payload.metadata.githubPr?.headBranch
            ? `origin/${data.payload.metadata.githubPr.headBranch}`
            : "HEAD");

        const { execSync } = await import("node:child_process");

        let content: string;
        try {
          content = execSync(`git show ${gitRef}:${file}`, {
            cwd: data.projectPath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 10 * 1024 * 1024,
          });
        } catch {
          const fs = await import("node:fs");
          const path = await import("node:path");
          try {
            content = fs.readFileSync(path.join(data.projectPath, file), "utf-8");
          } catch {
            return toolError(`File not found: "${file}" (tried git show ${gitRef}:${file} and working tree)`);
          }
        }

        return jsonResult({
          file,
          ref: gitRef,
          projectPath: data.projectPath,
          content,
          lineCount: content.split("\n").length,
        });
      }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
