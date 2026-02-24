#!/usr/bin/env node

import { Command } from "commander";
import { review } from "./commands/review.js";
import { serve } from "./commands/serve.js";
import { setup } from "./commands/setup.js";
import { teardown } from "./commands/teardown.js";
import { start } from "./commands/start.js";
import { watch } from "./commands/watch.js";
import { notifyStop } from "./commands/notify-stop.js";
import { server, serverStatus, serverStop } from "./commands/server.js";

declare const DIFFPRISM_VERSION: string;

const program = new Command();

program
  .name("diffprism")
  .description("Local-first code review tool for agent-generated changes")
  .version(typeof DIFFPRISM_VERSION !== "undefined" ? DIFFPRISM_VERSION : "0.0.0-dev");

program
  .command("review [ref]")
  .description("Open a browser-based diff review")
  .option("--staged", "Review staged changes")
  .option("--unstaged", "Review unstaged changes")
  .option("-t, --title <title>", "Review title")
  .option("--dev", "Use Vite dev server with HMR instead of static files")
  .action(review);

program
  .command("start [ref]")
  .description("Set up DiffPrism and start watching for changes")
  .option("--staged", "Watch staged changes")
  .option("--unstaged", "Watch unstaged changes")
  .option("-t, --title <title>", "Review title")
  .option("--interval <ms>", "Poll interval in milliseconds (default: 1000)")
  .option("--dev", "Use Vite dev server with HMR instead of static files")
  .option("--global", "Install skill globally (~/.claude/skills/)")
  .option("--force", "Overwrite existing configuration files")
  .action(start);

program
  .command("watch [ref]")
  .description("Start a persistent diff watcher with live-updating browser UI")
  .option("--staged", "Watch staged changes")
  .option("--unstaged", "Watch unstaged changes")
  .option("-t, --title <title>", "Review title")
  .option("--interval <ms>", "Poll interval in milliseconds (default: 1000)")
  .option("--dev", "Use Vite dev server with HMR instead of static files")
  .action(watch);

program
  .command("notify-stop")
  .description("Signal the watch server to refresh (used by Claude Code hooks)")
  .action(notifyStop);

program
  .command("serve")
  .description("Start the MCP server for Claude Code integration")
  .action(serve);

program
  .command("setup")
  .description("Configure DiffPrism for Claude Code integration")
  .option("--global", "Configure globally (skill + permissions, no git repo required)")
  .option("--force", "Overwrite existing configuration files")
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
