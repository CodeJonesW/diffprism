#!/usr/bin/env node

import { Command } from "commander";
import { review } from "./commands/review.js";
import { serve } from "./commands/serve.js";

const program = new Command();

program
  .name("diffprism")
  .description("Local-first code review tool for agent-generated changes")
  .version("0.0.1");

program
  .command("review [ref]")
  .description("Open a browser-based diff review")
  .option("--staged", "Review staged changes")
  .option("--unstaged", "Review unstaged changes")
  .option("-t, --title <title>", "Review title")
  .action(review);

program
  .command("serve")
  .description("Start the MCP server for Claude Code integration")
  .action(serve);

program.parse();
