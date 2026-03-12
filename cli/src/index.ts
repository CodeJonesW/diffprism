#!/usr/bin/env node

import { Command } from "commander";
import { review } from "./commands/review.js";
import { serve } from "./commands/serve.js";
import { setup } from "./commands/setup.js";
import { teardown } from "./commands/teardown.js";
import { demo } from "./commands/demo.js";
import { server, serverStatus, serverStop } from "./commands/server.js";
import { defaultAction } from "./commands/default.js";

declare const DIFFPRISM_VERSION: string;

const program = new Command();

program
  .name("diffprism")
  .description("Local-first code review tool for agent-generated changes")
  .version(typeof DIFFPRISM_VERSION !== "undefined" ? DIFFPRISM_VERSION : "0.0.0-dev");

program.action(defaultAction);

program
  .command("demo")
  .description("Open a sample review to see DiffPrism in action")
  .option("--dev", "Use Vite dev server")
  .action(demo);

program
  .command("review [ref]")
  .description("Open a browser-based diff review (local git ref or GitHub PR ref like owner/repo#123)")
  .option("--staged", "Review staged changes")
  .option("--unstaged", "Review unstaged changes")
  .option("-t, --title <title>", "Review title")
  .option("--reasoning <text>", "Agent reasoning about the changes")
  .option("--dev", "Use Vite dev server with HMR instead of static files")
  .option("--post-to-github", "Automatically post review back to GitHub without prompting")
  .action(review);

// Hidden alias for backwards compatibility
program
  .command("review-pr <pr>", { hidden: true })
  .action((pr: string, flags: Record<string, unknown>) => review(pr, flags));

program
  .command("serve")
  .description("Start the MCP server for Claude Code integration")
  .action(serve);

program
  .command("setup")
  .description("Configure DiffPrism for Claude Code integration")
  .option("--global", "Configure globally (skill + permissions, no git repo required)")
  .option("--force", "Overwrite existing configuration files")
  .option("--dev", "Use Vite dev server")
  .option("--no-demo", "Skip the demo review after setup")
  .action((flags) => { setup(flags); });

program
  .command("teardown")
  .description("Remove DiffPrism configuration from the current project")
  .option("--global", "Remove global configuration (skill + permissions at ~/.claude/)")
  .option("-q, --quiet", "Suppress output")
  .action((flags) => { teardown(flags); });

const serverCmd = program
  .command("server")
  .description("Start the global DiffPrism server for multi-session reviews")
  .option("-p, --port <port>", "HTTP API port (default: 24680)")
  .option("--ws-port <port>", "WebSocket port (default: 24681)")
  .option("--dev", "Use Vite dev server with HMR instead of static files")
  .option("--background", "Start server as a background daemon")
  .option("--_daemon", "Internal: run as spawned daemon (do not use directly)")
  .action(server);

serverCmd
  .command("status")
  .description("Check if the global server is running and list active sessions")
  .action(serverStatus);

serverCmd
  .command("stop")
  .description("Stop the running global server")
  .action(serverStop);

program.parse();
