#!/usr/bin/env node

import { Command } from "commander";
import { review } from "./commands/review.js";
import { serve } from "./commands/serve.js";
import { setup } from "./commands/setup.js";

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
  .command("serve")
  .description("Start the MCP server for Claude Code integration")
  .action(serve);

program
  .command("setup")
  .description("Configure DiffPrism for Claude Code integration")
  .option("--global", "Install skill globally (~/.claude/skills/)")
  .option("--force", "Overwrite existing configuration files")
  .action(setup);

program.parse();
