import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { startReview } from "@diffprism/core";

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
          'Git diff reference: "staged", "unstaged", or a ref range like "HEAD~3..HEAD"',
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
