---
title: Fail CI when docs drift from the code
date: 2026-09-17
kind: infra
pr: 192
---

## What changed

CI now runs `pnpm docs:check`. It fails the build when the README, the CLAUDE.md files, the usage docs or the `/review` skill describe something the code no longer has.

It checks structural claims only: MCP tool names and their parameters, tool counts like "14 tools", CLI commands and flags in code examples, repo paths, and the WebSocket message lists. Prose is left alone, so a sentence like "replaces `add_annotation`" still passes. Dated plan documents are skipped. Failures print as `file:line: message`, and show up as inline annotations on the PR.

## Why

We change tools, flags and messages quickly, and much of that work is done by agents. The docs fell behind without anyone noticing. That matters most for the CLAUDE.md files, because agents read them and trust them.

On the day it landed, the check found 15 problems on main. Three docs said there were 12 MCP tools when there were 14. CLAUDE.md listed 7 of the 15 WebSocket message types. The README's CLI reference was missing three commands.

## Decisions

The check reads the truth from the running code rather than scanning source text with regular expressions. It starts a real MCP server in memory and lists its tools. It walks the real CLI command tree. It reads the WebSocket message types from the TypeScript source.

To make that possible, we split building the MCP server and the CLI program out from starting them. The CLI entry point is now a single call that builds the program and parses the arguments.

## What we learned

If agents read your docs, stale docs are wrong instructions, not just untidy ones. The claims an agent acts on, such as tool names, parameters and flags, are also the ones a program can check.
