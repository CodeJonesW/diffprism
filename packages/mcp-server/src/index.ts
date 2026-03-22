import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ensureServer,
  submitReviewToServer,
  isServerAlive,
} from "@diffprism/core";
import type {
  ContextUpdatePayload,
  GlobalServerInfo,
  ReviewResult,
} from "@diffprism/core";
import { getDiff } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";
import {
  isPrRef,
  parsePrRef,
} from "@diffprism/github";

declare const DIFFPRISM_VERSION: string;

// Track the last session created on the global server so
// update_review_context and get_review_result can reference it.
let lastGlobalSessionId: string | null = null;
let lastGlobalServerInfo: GlobalServerInfo | null = null;

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

async function handleLocalReview(
  diffRef: string,
  options: {
    title?: string;
    description?: string;
    reasoning?: string;
    timeoutMs?: number;
    annotations?: Array<{
      file: string;
      line: number;
      body: string;
      type: "finding" | "suggestion" | "question" | "warning";
      confidence?: number;
      category?: string;
      source_agent?: string;
    }>;
  },
): Promise<{ mcpResult: McpToolResult; sessionId: string; serverInfo: GlobalServerInfo }> {
  const serverInfo = await ensureServer({ silent: true });

  const { result, sessionId } = await submitReviewToServer(
    serverInfo,
    diffRef,
    {
      title: options.title,
      description: options.description,
      reasoning: options.reasoning,
      cwd: process.cwd(),
      annotations: options.annotations,
      diffRef,
      timeoutMs: options.timeoutMs ?? 0,
    },
  );

  if (result) {
    return {
      mcpResult: {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      },
      sessionId,
      serverInfo,
    };
  }

  return {
    mcpResult: {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "session_created",
          sessionId,
          message: "Review session opened in DiffPrism dashboard. Use get_review_result to check for a decision.",
        }, null, 2),
      }],
    },
    sessionId,
    serverInfo,
  };
}

async function handlePrReview(
  pr: string,
  options: {
    title?: string;
    reasoning?: string;
    post_to_github?: boolean;
    timeoutMs?: number;
  },
): Promise<{ mcpResult: McpToolResult; sessionId: string; serverInfo: GlobalServerInfo }> {
  const { owner, repo, number } = parsePrRef(pr);

  // Auto-start server, then use /api/pr/open for local repo auto-detection
  const serverInfo = await ensureServer({ silent: true });

  const response = await fetch(
    `http://localhost:${serverInfo.httpPort}/api/pr/open`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prUrl: pr }),
    },
  );

  const data = await response.json() as {
    sessionId?: string;
    fileCount?: number;
    localRepoPath?: string | null;
    pr?: { title: string; author: string; url: string };
    error?: string;
  };

  if (!response.ok || !data.sessionId) {
    return {
      mcpResult: {
        content: [{ type: "text" as const, text: `Error: ${data.error ?? "Failed to open PR"}` }],
        isError: true,
      },
      sessionId: "",
      serverInfo,
    };
  }

  const sessionId = data.sessionId;

  // If caller wants to block, poll for result
  if (options.timeoutMs && options.timeoutMs > 0) {
    const start = Date.now();
    while (Date.now() - start < options.timeoutMs) {
      const resultResponse = await fetch(
        `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/result`,
      );
      if (resultResponse.ok) {
        const resultData = (await resultResponse.json()) as {
          result: import("@diffprism/core").ReviewResult | null;
          status: string;
        };
        if (resultData.result) {
          return {
            mcpResult: {
              content: [{ type: "text" as const, text: JSON.stringify(resultData.result, null, 2) }],
            },
            sessionId,
            serverInfo,
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Non-blocking: return session info
  return {
    mcpResult: {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "session_created",
          sessionId,
          pr: `${owner}/${repo}#${number}`,
          fileCount: data.fileCount,
          localRepoConnected: !!data.localRepoPath,
          localRepoPath: data.localRepoPath,
          message: "PR review session opened in DiffPrism. Use get_pr_context, get_file_diff, get_file_context to explore the changes. Use add_review_comment to post findings.",
        }, null, 2),
      }],
    },
    sessionId,
    serverInfo,
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "diffprism",
    version: typeof DIFFPRISM_VERSION !== "undefined" ? DIFFPRISM_VERSION : "0.0.0-dev",
  });

  server.tool(
    "open_review",
    "Open a review session in the DiffPrism dashboard for local git changes or a GitHub pull request. Returns immediately with the session ID after registering the session. Use `get_review_result` with `wait: true` when you need the reviewer's decision before proceeding.",
    {
      diff_ref: z
        .string()
        .describe(
          'Git diff reference: "staged", "unstaged", "working-copy" (staged+unstaged grouped), a ref range like "HEAD~3..HEAD", or a GitHub PR ref like "owner/repo#123" or a GitHub PR URL',
        ),
      title: z.string().optional().describe("Title for the review"),
      description: z
        .string()
        .optional()
        .describe("Description of the changes"),
      reasoning: z
        .string()
        .optional()
        .describe("Summarize what you were trying to accomplish in this session in plain English. This is displayed as the session subtitle in the DiffPrism dashboard and is the primary way users identify sessions at a glance. Always populate this."),
      post_to_github: z
        .boolean()
        .optional()
        .describe("Post the review back to GitHub after submission (only for PR refs, default: false)"),
      timeout_ms: z
        .number()
        .optional()
        .describe("How long to wait for a review decision (ms). Defaults to 0 (non-blocking, returns immediately after session creation). Set to a positive value to poll for a result up to that duration before returning."),
      annotations: z
        .array(
          z.object({
            file: z.string().describe("File path within the diff to annotate"),
            line: z.number().describe("Line number to annotate"),
            body: z.string().describe("The annotation text"),
            type: z
              .enum(["finding", "suggestion", "question", "warning"])
              .describe("Type of annotation"),
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
            source_agent: z
              .string()
              .optional()
              .describe("Agent identifier (e.g., 'security-reviewer')"),
          }),
        )
        .optional()
        .describe("Initial annotations to attach to the review"),
    },
    async ({ diff_ref, title, description, reasoning, post_to_github, timeout_ms, annotations }) => {
      try {
        let mcpResult: McpToolResult;
        let sessionId: string;
        let serverInfo: GlobalServerInfo;

        if (isPrRef(diff_ref)) {
          ({ mcpResult, sessionId, serverInfo } = await handlePrReview(diff_ref, {
            title,
            reasoning,
            post_to_github,
            timeoutMs: timeout_ms,
          }));
        } else {
          ({ mcpResult, sessionId, serverInfo } = await handleLocalReview(diff_ref, {
            title,
            description,
            reasoning,
            annotations,
            timeoutMs: timeout_ms,
          }));
        }

        // Store for update_review_context / get_review_result
        if (sessionId) {
          lastGlobalSessionId = sessionId;
          lastGlobalServerInfo = serverInfo;
        }

        return mcpResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "update_review_context",
    "Push reasoning/context to a running DiffPrism review session. Non-blocking — returns immediately. Updates the review UI with agent reasoning without opening a new review. Requires a prior `open_review` call in this session.",
    {
      reasoning: z
        .string()
        .optional()
        .describe("Agent reasoning about the current changes"),
      title: z.string().optional().describe("Updated title for the review"),
      description: z
        .string()
        .optional()
        .describe("Updated description of the changes"),
    },
    async ({ reasoning, title, description }) => {
      try {
        const payload: ContextUpdatePayload = {};
        if (reasoning !== undefined) payload.reasoning = reasoning;
        if (title !== undefined) payload.title = title;
        if (description !== undefined) payload.description = description;

        const serverInfo = lastGlobalServerInfo ?? (await isServerAlive());
        if (!serverInfo || !lastGlobalSessionId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No DiffPrism session is running. Use `open_review` to start a review.",
              },
            ],
          };
        }

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${lastGlobalSessionId}/context`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: "Context updated in DiffPrism session.",
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating review context: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_review_result",
    "Fetch the most recent review result from a DiffPrism session. Returns the reviewer's decision and comments if a review has been submitted, or a message indicating no pending result. Use wait=true to block until a result is available — this is the standard way to wait for a reviewer's decision after calling open_review.",
    {
      wait: z
        .boolean()
        .optional()
        .describe("If true, poll until a review result is available (blocks up to timeout)"),
      timeout: z
        .number()
        .optional()
        .describe("Max wait time in seconds when wait=true (default: 300, max: 600)"),
    },
    async ({ wait, timeout }) => {
      try {
        const maxWaitMs = Math.min((timeout ?? 300), 600) * 1000;
        const pollIntervalMs = 2000;

        const serverInfo = lastGlobalServerInfo ?? (await isServerAlive());
        if (!serverInfo || !lastGlobalSessionId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No DiffPrism session is running. Use `open_review` to start a review.",
              },
            ],
          };
        }

        if (wait) {
          const start = Date.now();
          while (Date.now() - start < maxWaitMs) {
            const response = await fetch(
              `http://localhost:${serverInfo.httpPort}/api/reviews/${lastGlobalSessionId}/result`,
            );
            if (response.ok) {
              const data = (await response.json()) as {
                result: ReviewResult | null;
                status: string;
              };
              if (data.result) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify(data.result, null, 2),
                    },
                  ],
                };
              }
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }
          return {
            content: [
              {
                type: "text" as const,
                text: "No review result received within timeout.",
              },
            ],
          };
        }

        // Non-blocking check
        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${lastGlobalSessionId}/result`,
        );
        if (response.ok) {
          const data = (await response.json()) as {
            result: ReviewResult | null;
            status: string;
          };
          if (data.result) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(data.result, null, 2),
                },
              ],
            };
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: "No pending review result.",
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading review result: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

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
        const cwd = process.cwd();
        const { diffSet } = getDiff(diff_ref, { cwd });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(diffSet, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
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
        const cwd = process.cwd();
        const { diffSet } = getDiff(diff_ref, { cwd });

        if (diffSet.files.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
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
                }, null, 2),
              },
            ],
          };
        }

        const briefing = analyze(diffSet);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(briefing, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "add_annotation",
    "Post a structured finding (annotation) to a review session. Use this to flag issues, suggest improvements, or ask questions about specific lines of code in a review. Requires a running global server (`diffprism server`).",
    {
      session_id: z
        .string()
        .describe("Review session ID from open_review"),
      file: z.string().describe("File path within the diff to annotate"),
      line: z.number().describe("Line number to annotate"),
      body: z
        .string()
        .describe("The annotation text — your finding, suggestion, or question"),
      type: z
        .enum(["finding", "suggestion", "question", "warning"])
        .describe("Type of annotation"),
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
      source_agent: z
        .string()
        .optional()
        .describe("Agent identifier (e.g., 'security-reviewer')"),
    },
    async ({
      session_id,
      file,
      line,
      body,
      type,
      confidence,
      category,
      source_agent,
    }) => {
      try {
        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No global server running. Start one with `diffprism server`.",
              },
            ],
            isError: true,
          };
        }

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${session_id}/annotations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file,
              line,
              body,
              type,
              confidence: confidence ?? 1,
              category: category ?? "other",
              source: {
                agent: source_agent ?? "unknown",
                tool: "add_annotation",
              },
            }),
          },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg =
            (errorData as Record<string, string>).error ??
            `Server returned ${response.status}`;
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${errorMsg}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await response.json()) as { annotationId: string };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { annotationId: data.annotationId, sessionId: session_id },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_review_state",
    "Get the current state of a review session including session summary and annotations. Returns session metadata, status, and any agent annotations. Use this to check on a review's progress or read agent findings.",
    {
      session_id: z
        .string()
        .optional()
        .describe(
          "Review session ID. If omitted, uses the most recently created session.",
        ),
    },
    async ({ session_id }) => {
      try {
        const sessionId = session_id ?? lastGlobalSessionId;
        if (!sessionId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No session ID provided and no recent session available.",
              },
            ],
            isError: true,
          };
        }

        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No global server running. Start one with `diffprism server`.",
              },
            ],
            isError: true,
          };
        }

        const [sessionResponse, annotationsResponse] = await Promise.all([
          fetch(
            `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}`,
          ),
          fetch(
            `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/annotations`,
          ),
        ]);

        if (!sessionResponse.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session not found: ${sessionId}`,
              },
            ],
            isError: true,
          };
        }

        const session = await sessionResponse.json();
        const annotations = annotationsResponse.ok
          ? await annotationsResponse.json()
          : { annotations: [] };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session,
                  annotations: (annotations as { annotations: unknown[] })
                    .annotations,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "flag_for_attention",
    "Mark specific files in a review session for human attention. Posts warning annotations for each flagged file. Use this to highlight files that need careful human review. Requires a running global server (`diffprism server`).",
    {
      session_id: z
        .string()
        .optional()
        .describe(
          "Review session ID. If omitted, uses the most recently created session.",
        ),
      files: z
        .array(
          z.object({
            path: z.string().describe("File path to flag for attention"),
            reason: z
              .string()
              .describe("Why this file needs human attention"),
            line: z
              .number()
              .optional()
              .describe("Specific line to highlight (defaults to 1)"),
          }),
        )
        .describe("Files to flag for human attention"),
      source_agent: z
        .string()
        .optional()
        .describe("Agent identifier (e.g., 'security-reviewer')"),
    },
    async ({ session_id, files, source_agent }) => {
      try {
        const sessionId = session_id ?? lastGlobalSessionId;
        if (!sessionId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No session ID provided and no recent session available.",
              },
            ],
            isError: true,
          };
        }

        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No global server running. Start one with `diffprism server`.",
              },
            ],
            isError: true,
          };
        }

        let flagged = 0;
        for (const file of files) {
          const response = await fetch(
            `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/annotations`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                file: file.path,
                line: file.line ?? 1,
                body: file.reason,
                type: "warning",
                confidence: 1,
                category: "other",
                source: {
                  agent: source_agent ?? "flag_for_attention",
                  tool: "flag_for_attention",
                },
              }),
            },
          );

          if (response.ok) {
            flagged++;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ flagged, sessionId }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ─── Super Review Tools ───

  server.tool(
    "get_pr_context",
    "Get a high-level overview of the active PR review session. Returns PR metadata (title, author, branches, URL), review briefing summary, file list with stats, and local repo path. Use this to orient yourself before diving into specific files.",
    {
      session_id: z
        .string()
        .optional()
        .describe("Review session ID. If omitted, uses the most recently created session."),
    },
    async ({ session_id }) => {
      try {
        const sessionId = session_id ?? lastGlobalSessionId;
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "No session ID provided and no recent session available. Open a PR review first." }],
            isError: true,
          };
        }

        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [{ type: "text" as const, text: "No global server running. Start one with `diffprism server`." }],
            isError: true,
          };
        }

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/payload`,
        );
        if (!response.ok) {
          return {
            content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }],
            isError: true,
          };
        }

        const data = await response.json() as {
          payload: { diffSet: { files: Array<{ path: string; status: string; additions: number; deletions: number; language: string }> }; briefing: { summary: string; triage: unknown }; metadata: { title?: string; description?: string; githubPr?: { owner: string; repo: string; number: number; title: string; author: string; url: string; baseBranch: string; headBranch: string } } };
          projectPath: string;
        };

        const { payload, projectPath } = data;
        const result = {
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
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_file_diff",
    "Get the diff hunks for a specific file in the active review session. Returns the file's changes (additions, deletions, hunks with line-level detail) and its briefing categorization. Use this to focus on one file at a time.",
    {
      file: z.string().describe("File path within the diff (e.g., 'src/index.ts')"),
      session_id: z
        .string()
        .optional()
        .describe("Review session ID. If omitted, uses the most recently created session."),
    },
    async ({ file, session_id }) => {
      try {
        const sessionId = session_id ?? lastGlobalSessionId;
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "No session ID provided and no recent session available." }],
            isError: true,
          };
        }

        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [{ type: "text" as const, text: "No global server running." }],
            isError: true,
          };
        }

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/payload`,
        );
        if (!response.ok) {
          return {
            content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }],
            isError: true,
          };
        }

        const data = await response.json() as {
          payload: {
            diffSet: { files: Array<{ path: string; status: string; additions: number; deletions: number; language: string; hunks: unknown[]; oldPath?: string }> };
            briefing: { triage: { critical: Array<{ file: string }>; notable: Array<{ file: string }>; mechanical: Array<{ file: string }> }; fileStats: Array<{ path: string; language: string; status: string; additions: number; deletions: number }> };
          };
        };

        const diffFile = data.payload.diffSet.files.find((f) => f.path === file);
        if (!diffFile) {
          const available = data.payload.diffSet.files.map((f) => f.path);
          return {
            content: [{ type: "text" as const, text: `File not found in diff: "${file}". Available files:\n${available.join("\n")}` }],
            isError: true,
          };
        }

        // Determine triage category
        const { triage } = data.payload.briefing;
        let category = "mechanical";
        if (triage.critical.some((c: { file: string }) => c.file === file)) category = "critical";
        else if (triage.notable.some((n: { file: string }) => n.file === file)) category = "notable";

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            path: diffFile.path,
            oldPath: diffFile.oldPath,
            status: diffFile.status,
            language: diffFile.language,
            additions: diffFile.additions,
            deletions: diffFile.deletions,
            triageCategory: category,
            hunks: diffFile.hunks,
          }, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_file_context",
    "Get the full content of a file from the local repository. Uses `git show` to read the file at the PR's head branch without switching branches. Requires the review session to be connected to a local repo (server must be running from within the repo clone).",
    {
      file: z.string().describe("File path relative to repo root (e.g., 'src/index.ts')"),
      ref: z
        .string()
        .optional()
        .describe("Git ref to read from (e.g., 'origin/main', 'HEAD'). Defaults to the PR's head branch if available, otherwise HEAD."),
      session_id: z
        .string()
        .optional()
        .describe("Review session ID. If omitted, uses the most recently created session."),
    },
    async ({ file, ref, session_id }) => {
      try {
        const sessionId = session_id ?? lastGlobalSessionId;
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "No session ID provided and no recent session available." }],
            isError: true,
          };
        }

        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [{ type: "text" as const, text: "No global server running." }],
            isError: true,
          };
        }

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/payload`,
        );
        if (!response.ok) {
          return {
            content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }],
            isError: true,
          };
        }

        const data = await response.json() as {
          projectPath: string;
          payload: { metadata: { githubPr?: { headBranch: string } } };
        };

        if (data.projectPath.startsWith("github:")) {
          return {
            content: [{ type: "text" as const, text: "No local repo connected. Run the server from within a local clone of the repository to enable file context." }],
            isError: true,
          };
        }

        // Determine the ref to read from
        const gitRef = ref ?? (data.payload.metadata.githubPr?.headBranch
          ? `origin/${data.payload.metadata.githubPr.headBranch}`
          : "HEAD");

        const { execSync } = await import("node:child_process");

        let content: string;
        try {
          content = execSync(`git show ${gitRef}:${file}`, {
            cwd: data.projectPath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 10 * 1024 * 1024, // 10MB
          });
        } catch {
          // Fallback: try reading from working tree
          const fs = await import("node:fs");
          const path = await import("node:path");
          const filePath = path.join(data.projectPath, file);
          try {
            content = fs.readFileSync(filePath, "utf-8");
          } catch {
            return {
              content: [{ type: "text" as const, text: `File not found: "${file}" (tried git show ${gitRef}:${file} and working tree)` }],
              isError: true,
            };
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            file,
            ref: gitRef,
            projectPath: data.projectPath,
            content,
            lineCount: content.split("\n").length,
          }, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "add_review_comment",
    "Post a review comment to the active session. The comment appears in the DiffPrism browser UI in real-time as an inline annotation on the diff. Use this to leave findings, suggestions, or questions about specific lines of code.",
    {
      file: z.string().describe("File path within the diff"),
      line: z.number().describe("Line number to comment on"),
      body: z.string().describe("The comment text"),
      type: z
        .enum(["comment", "suggestion", "concern"])
        .optional()
        .describe("Type of comment (default: 'comment')"),
      session_id: z
        .string()
        .optional()
        .describe("Review session ID. If omitted, uses the most recently created session."),
    },
    async ({ file, line, body, type, session_id }) => {
      try {
        const sessionId = session_id ?? lastGlobalSessionId;
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "No session ID provided and no recent session available." }],
            isError: true,
          };
        }

        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [{ type: "text" as const, text: "No global server running." }],
            isError: true,
          };
        }

        // Map comment type to annotation type
        const annotationType = type === "concern" ? "warning" : type === "suggestion" ? "suggestion" : "finding";

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/annotations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file,
              line,
              body,
              type: annotationType,
              confidence: 1,
              category: "other",
              source: {
                agent: "ai-reviewer",
                tool: "add_review_comment",
              },
            }),
          },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          return {
            content: [{ type: "text" as const, text: `Error: ${(errorData as Record<string, string>).error ?? `Server returned ${response.status}`}` }],
            isError: true,
          };
        }

        const data = (await response.json()) as { annotationId: string };
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ annotationId: data.annotationId, sessionId }, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_review_comments",
    "Get all comments and annotations on the active review session. Returns findings from agents and inline comments from human reviewers. Use this to see what has already been noted before adding your own comments.",
    {
      session_id: z
        .string()
        .optional()
        .describe("Review session ID. If omitted, uses the most recently created session."),
    },
    async ({ session_id }) => {
      try {
        const sessionId = session_id ?? lastGlobalSessionId;
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "No session ID provided and no recent session available." }],
            isError: true,
          };
        }

        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [{ type: "text" as const, text: "No global server running." }],
            isError: true,
          };
        }

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/annotations`,
        );
        if (!response.ok) {
          return {
            content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }],
            isError: true,
          };
        }

        const data = (await response.json()) as { annotations: unknown[] };
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ sessionId, annotations: data.annotations }, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_user_focus",
    "Get what the user is currently looking at in the DiffPrism review UI. Returns the file they have selected and any line range they are focused on. Use this to provide context-aware help — answer questions about the code the user is actively reviewing.",
    {
      session_id: z
        .string()
        .optional()
        .describe("Review session ID. If omitted, uses the most recently created session."),
    },
    async ({ session_id }) => {
      try {
        const sessionId = session_id ?? lastGlobalSessionId;
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "No session ID provided and no recent session available." }],
            isError: true,
          };
        }

        const serverInfo = await isServerAlive();
        if (!serverInfo) {
          return {
            content: [{ type: "text" as const, text: "No global server running." }],
            isError: true,
          };
        }

        const response = await fetch(
          `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/focus`,
        );
        if (!response.ok) {
          return {
            content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }],
            isError: true,
          };
        }

        const data = (await response.json()) as { focus: { file: string | null; lineStart?: number; lineEnd?: number; updatedAt: number } | null };
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ sessionId, ...data }, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
