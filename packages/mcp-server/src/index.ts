import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  startReview,
  readWatchFile,
  readReviewResult,
  consumeReviewResult,
  isServerAlive,
} from "@diffprism/core";
import type {
  ContextUpdatePayload,
  GlobalServerInfo,
  ReviewInitPayload,
  ReviewResult,
} from "@diffprism/core";
import { getDiff, getCurrentBranch, detectWorktree } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";
import {
  resolveGitHubToken,
  parsePrRef,
  createGitHubClient,
  fetchPullRequest,
  fetchPullRequestDiff,
  normalizePr,
  submitGitHubReview,
} from "@diffprism/github";

declare const DIFFPRISM_VERSION: string;

// Track the last session created on the global server so
// update_review_context and get_review_result can reference it.
let lastGlobalSessionId: string | null = null;
let lastGlobalServerInfo: GlobalServerInfo | null = null;

/**
 * Compute diff locally, POST to global server, poll for result.
 * Returns the ReviewResult once the user submits in the UI.
 */
async function reviewViaGlobalServer(
  serverInfo: GlobalServerInfo,
  diffRef: string,
  options: {
    title?: string;
    description?: string;
    reasoning?: string;
    cwd?: string;
  },
): Promise<ReviewResult> {
  const cwd = options.cwd ?? process.cwd();

  // 1. Compute diff and analysis locally (MCP has git access)
  const { diffSet, rawDiff } = getDiff(diffRef, { cwd });
  const currentBranch = getCurrentBranch({ cwd });

  if (diffSet.files.length === 0) {
    return {
      decision: "approved",
      comments: [],
      summary: "No changes to review.",
    };
  }

  const briefing = analyze(diffSet);

  // 2. Detect worktree info
  const worktreeInfo = detectWorktree({ cwd });

  // 3. Build the payload
  const payload: ReviewInitPayload = {
    reviewId: "", // Server assigns the real ID
    diffSet,
    rawDiff,
    briefing,
    metadata: {
      title: options.title,
      description: options.description,
      reasoning: options.reasoning,
      currentBranch,
      worktree: worktreeInfo.isWorktree
        ? {
            isWorktree: true,
            worktreePath: worktreeInfo.worktreePath,
            mainWorktreePath: worktreeInfo.mainWorktreePath,
          }
        : undefined,
    },
  };

  // 4. POST to global server
  const createResponse = await fetch(
    `http://localhost:${serverInfo.httpPort}/api/reviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, projectPath: cwd, diffRef }),
    },
  );

  if (!createResponse.ok) {
    throw new Error(`Global server returned ${createResponse.status} on create`);
  }

  const { sessionId } = (await createResponse.json()) as { sessionId: string };

  // Store for update_review_context / get_review_result
  lastGlobalSessionId = sessionId;
  lastGlobalServerInfo = serverInfo;

  // 5. Poll for result
  const pollIntervalMs = 2000;
  const maxWaitMs = 600 * 1000; // 10 minutes
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const resultResponse = await fetch(
      `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/result`,
    );

    if (resultResponse.ok) {
      const data = (await resultResponse.json()) as {
        result: ReviewResult | null;
        status: string;
      };

      if (data.result) {
        return data.result;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Review timed out waiting for submission.");
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "diffprism",
    version: typeof DIFFPRISM_VERSION !== "undefined" ? DIFFPRISM_VERSION : "0.0.0-dev",
  });

  server.tool(
    "open_review",
    "Open a browser-based code review for local git changes. Blocks until the engineer submits their review decision.",
    {
      diff_ref: z
        .string()
        .describe(
          'Git diff reference: "staged", "unstaged", "working-copy" (staged+unstaged grouped), or a ref range like "HEAD~3..HEAD"',
        ),
      title: z.string().optional().describe("Title for the review"),
      description: z
        .string()
        .optional()
        .describe("Description of the changes"),
      reasoning: z
        .string()
        .optional()
        .describe("Agent reasoning about why these changes were made"),
    },
    async ({ diff_ref, title, description, reasoning }) => {
      try {
        // Check for a running global server
        const serverInfo = await isServerAlive();

        if (serverInfo) {
          // Route through global server
          const result = await reviewViaGlobalServer(serverInfo, diff_ref, {
            title,
            description,
            reasoning,
            cwd: process.cwd(),
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Fallback: in-process review (no global server running)
        const isDev = fs.existsSync(
          path.join(process.cwd(), "packages", "ui", "src", "App.tsx"),
        );

        const result = await startReview({
          diffRef: diff_ref,
          title,
          description,
          reasoning,
          cwd: process.cwd(),
          silent: true,
          dev: isDev,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
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
    "update_review_context",
    "Push reasoning/context to a running DiffPrism review session. Non-blocking — returns immediately. Use this when `diffprism watch` or `diffprism server` is running to update the review UI with agent reasoning without opening a new review.",
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

        // Try global server first
        if (lastGlobalSessionId && lastGlobalServerInfo) {
          const serverInfo = await isServerAlive();
          if (serverInfo) {
            const response = await fetch(
              `http://localhost:${serverInfo.httpPort}/api/reviews/${lastGlobalSessionId}/context`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              },
            );

            if (response.ok) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Context updated in DiffPrism global server session.",
                  },
                ],
              };
            }
          }
        }

        // Fallback: try watch session
        const watchInfo = readWatchFile();
        if (!watchInfo) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No DiffPrism session is running. Start one with `diffprism watch` or `diffprism server`.",
              },
            ],
          };
        }

        const response = await fetch(
          `http://localhost:${watchInfo.wsPort}/api/context`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );

        if (!response.ok) {
          throw new Error(`Watch server returned ${response.status}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: "Context updated in DiffPrism watch session.",
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
    "Fetch the most recent review result from a DiffPrism session. Returns the reviewer's decision and comments if a review has been submitted, or a message indicating no pending result. The result is marked as consumed after retrieval so it won't be returned again. Use wait=true to block until a result is available (recommended after pushing context to a watch session).",
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

        // Try global server first
        if (lastGlobalSessionId && lastGlobalServerInfo) {
          const serverInfo = await isServerAlive();
          if (serverInfo) {
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
          }
        }

        // Fallback: file-based watch session result
        if (wait) {
          const start = Date.now();
          while (Date.now() - start < maxWaitMs) {
            const data = readReviewResult();
            if (data) {
              consumeReviewResult();
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(data.result, null, 2),
                  },
                ],
              };
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

        const data = readReviewResult();
        if (!data) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No pending review result.",
              },
            ],
          };
        }

        consumeReviewResult();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data.result, null, 2),
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

  server.tool(
    "review_pr",
    "Open a browser-based code review for a GitHub pull request. Fetches the PR diff, runs DiffPrism analysis, and opens the review UI. Blocks until the engineer submits their review decision. Optionally posts the review back to GitHub.",
    {
      pr: z
        .string()
        .describe(
          'GitHub PR reference: "owner/repo#123" or "https://github.com/owner/repo/pull/123"',
        ),
      title: z.string().optional().describe("Override review title"),
      reasoning: z
        .string()
        .optional()
        .describe("Agent reasoning about the PR changes"),
      post_to_github: z
        .boolean()
        .optional()
        .describe("Post the review back to GitHub after submission (default: false)"),
    },
    async ({ pr, title, reasoning, post_to_github }) => {
      try {
        // 1. Resolve GitHub token
        const token = resolveGitHubToken();

        // 2. Parse PR ref
        const { owner, repo, number } = parsePrRef(pr);

        // 3. Fetch PR data
        const client = createGitHubClient(token);
        const [prMetadata, rawDiff] = await Promise.all([
          fetchPullRequest(client, owner, repo, number),
          fetchPullRequestDiff(client, owner, repo, number),
        ]);

        if (!rawDiff.trim()) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  decision: "approved",
                  comments: [],
                  summary: "PR has no changes to review.",
                }, null, 2),
              },
            ],
          };
        }

        // 4. Normalize to DiffPrism types
        const { payload } = normalizePr(rawDiff, prMetadata, { title, reasoning });

        // 5. Route to global server or fall back to in-process
        const serverInfo = await isServerAlive();

        let result: ReviewResult;

        if (serverInfo) {
          // POST to global server
          const createResponse = await fetch(
            `http://localhost:${serverInfo.httpPort}/api/reviews`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                payload,
                projectPath: `github:${owner}/${repo}`,
                diffRef: `PR #${number}`,
              }),
            },
          );

          if (!createResponse.ok) {
            throw new Error(`Global server returned ${createResponse.status}`);
          }

          const { sessionId } = (await createResponse.json()) as { sessionId: string };
          lastGlobalSessionId = sessionId;
          lastGlobalServerInfo = serverInfo;

          // Poll for result
          const pollIntervalMs = 2000;
          const maxWaitMs = 600 * 1000;
          const start = Date.now();

          while (Date.now() - start < maxWaitMs) {
            const resultResponse = await fetch(
              `http://localhost:${serverInfo.httpPort}/api/reviews/${sessionId}/result`,
            );

            if (resultResponse.ok) {
              const data = (await resultResponse.json()) as {
                result: ReviewResult | null;
                status: string;
              };
              if (data.result) {
                result = data.result;
                break;
              }
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }

          result ??= { decision: "dismissed", comments: [], summary: "Review timed out." };
        } else {
          // In-process review with injected payload
          const isDev = fs.existsSync(
            path.join(process.cwd(), "packages", "ui", "src", "App.tsx"),
          );

          result = await startReview({
            diffRef: `PR #${number}`,
            title: payload.metadata.title,
            description: payload.metadata.description,
            reasoning: payload.metadata.reasoning,
            cwd: process.cwd(),
            silent: true,
            dev: isDev,
            injectedPayload: payload,
          });
        }

        // 6. Optionally post review back to GitHub
        if (post_to_github && result.decision !== "dismissed") {
          const posted = await submitGitHubReview(client, owner, repo, number, result);
          if (posted) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    ...result,
                    githubReviewId: posted.reviewId,
                    githubReviewUrl: `${prMetadata.url}#pullrequestreview-${posted.reviewId}`,
                  }, null, 2),
                },
              ],
            };
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
