# DiffPrism CLI

Commander-based CLI entry point. Thin wrapper around core pipeline.

## Commands

### `diffprism review [ref]`
- `--staged` — Review staged changes (default if no ref)
- `--unstaged` — Review unstaged changes
- `-t, --title <title>` — Set review title
- Ref can be any git range: `HEAD~3..HEAD`, `main..feature`, etc.
- Opens browser, blocks until review submitted, prints JSON result to stdout

### `diffprism serve`
- Starts MCP server (dynamically imports @diffprism/mcp-server)
- Connects StdioServerTransport for Claude Code integration

## Key Files

- `src/index.ts` — Commander setup and routing
- `src/commands/review.ts` — Review command handler
- `src/commands/serve.ts` — MCP serve command (dynamic import)

## Running

```bash
npx tsx cli/src/index.ts review --staged
npx tsx cli/src/index.ts serve
```
