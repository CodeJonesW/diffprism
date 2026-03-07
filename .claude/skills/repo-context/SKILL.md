---
name: repo-context
description: Index a repository and query its architecture, conventions, file context, and dependencies using the repo-context MCP server.
---

# Repo Context

You have 7 repo-context MCP tools available for understanding codebases. Use them to get architecture, conventions, file-level context, and semantic search before making changes.

## Workflow 1: Index Before Querying

Before using any query tools, the repository must be indexed. Check if it's already indexed by calling `mcp__repo-context__get_architecture` — if it returns empty or errors, index first.

### Index a GitHub repo
Call `mcp__repo-context__index_repo` with `owner`, `repo`, `branch`, and `github_token`.

### Index a local repo
Call `mcp__repo-context__index_local` with pre-walked entries and file contents. The CLI helper `pnpm index-local` in the repo-context-service project handles this automatically.

## Workflow 2: Understand a Codebase

When starting work on an unfamiliar repo or reviewing significant changes:

1. **Get architecture** — Call `mcp__repo-context__get_architecture` with `owner` and `repo`
   - Returns: primary language, frameworks, directory structure with purposes, entry points, config files, file stats by language
2. **Get conventions** — Call `mcp__repo-context__get_conventions` with `owner` and `repo`
   - Returns: naming conventions, test patterns, import style, tooling (linter, formatter, type system), framework idioms
3. Use this context to align your code with the project's existing patterns.

## Workflow 3: Understand a Specific File

Before modifying a file or reviewing changes to it:

1. Call `mcp__repo-context__get_file_context` with `owner`, `repo`, and `path`
   - Returns: language, size, exports, imports, dependents (files that import it), and semantic code chunks
2. Use dependents to understand blast radius — what else might break if this file changes.

## Workflow 4: Find Related Files

When reviewing a set of changes and you need to understand what else might be affected:

1. Call `mcp__repo-context__get_related_files` with `owner`, `repo`, and `paths` (array of changed file paths)
   - Returns: files connected via import graph + semantically similar files
2. Use this to identify missing test updates, forgotten co-changes, or downstream impact.

## Workflow 5: Search the Codebase

When you need to find code by meaning or keywords:

1. Call `mcp__repo-context__search_codebase` with `owner`, `repo`, `query`, and optional `limit`
   - Tries semantic (vector) search first, falls back to keyword matching
   - Returns code chunks with file paths, line numbers, and relevance scores
2. Use natural language queries for best results (e.g., "authentication middleware" rather than "auth").

## Tool Reference

### Indexing
| Tool | Purpose |
|------|---------|
| `index_repo` | Index a GitHub repository (needs personal access token). |
| `index_local` | Index a local repo from pre-walked filesystem data. |

### Querying
| Tool | Purpose |
|------|---------|
| `get_architecture` | Project structure, language, frameworks, entry points. Cached 10 min. |
| `get_conventions` | Coding standards, naming, test patterns, tooling. Cached 10 min. |
| `get_file_context` | File-level detail: imports, exports, dependents, code chunks. |
| `get_related_files` | Files affected by a set of changes (import graph + similarity). |
| `search_codebase` | Semantic + keyword search across indexed code. |

### Health
| Tool | Purpose |
|------|---------|
| `ping` | Check if the repo-context service is running. |

## Integration with DiffPrism

When performing code review with DiffPrism, use repo-context to enrich your review:

1. Before `open_review`, call `get_related_files` with the changed paths to identify missing changes
2. Use `get_file_context` on critical changed files to understand their dependents
3. Use `get_conventions` to check if changes follow project patterns
4. Include findings as annotations in your DiffPrism review

## Rules

- **Always check if indexed first** — query tools return empty results for unindexed repos. Call `get_architecture` to verify.
- **Use context to align code** — when writing or reviewing code, check conventions and architecture to match the project's style.
- **Understand blast radius** — before approving changes, use `get_related_files` and `get_file_context` to check downstream impact.
- **Repos are identified by owner/repo** — use the GitHub owner and repo name (e.g., `owner: "vercel"`, `repo: "next.js"`). For local repos, use any consistent owner/repo pair.
