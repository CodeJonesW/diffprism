import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { startReview, readWatchFile, readReviewResult, consumeReviewResult } from "@diffprism/core";
import type { ContextUpdatePayload } from "@diffprism/core";

declare const DIFFPRISM_VERSION: string;

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
        // Auto-detect dev mode when running inside the diffprism workspace
        const isDev = fs.existsSync(
          path.join(process.cwd(), "packages", "ui", "src", "App.tsx"),
        );

        const result = await startReview({
          diffRef: diff_ref,
          title,
          description,
          reasoning,
          cwd: process.cwd(),
          silent: true, // Suppress stdout — MCP uses stdio
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
    "Push reasoning/context to a running DiffPrism watch session. Non-blocking — returns immediately. Use this when `diffprism watch` is running to update the review UI with agent reasoning without opening a new review.",
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
        const watchInfo = readWatchFile();
        if (!watchInfo) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No DiffPrism watch session is running. Start one with `diffprism watch`.",
              },
            ],
          };
        }

        const payload: ContextUpdatePayload = {};
        if (reasoning !== undefined) payload.reasoning = reasoning;
        if (title !== undefined) payload.title = title;
        if (description !== undefined) payload.description = description;

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
              text: `Error updating watch context: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_review_result",
    "Fetch the most recent review result from a DiffPrism watch session. Returns the reviewer's decision and comments if a review has been submitted, or a message indicating no pending result. The result is marked as consumed after retrieval so it won't be returned again. Use wait=true to block until a result is available (recommended after pushing context to a watch session).",
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
        if (wait) {
          const maxWaitMs = Math.min((timeout ?? 300), 600) * 1000;
          const pollIntervalMs = 2000;
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
