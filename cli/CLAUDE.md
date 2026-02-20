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

### `diffprism setup`
- Configures DiffPrism for Claude Code integration in one command
- Creates/merges `.mcp.json` with DiffPrism MCP server entry
- Creates/merges `.claude/settings.json` with auto-approve permission for `open_review`
- Installs `/review` skill to `.claude/skills/review/SKILL.md`
- `--global` — Install skill globally (`~/.claude/skills/`) instead of project-level
- `--force` — Overwrite existing configuration files
- Idempotent: skips files that are already correctly configured

## Key Files

- `src/index.ts` — Commander setup and routing
- `src/commands/review.ts` — Review command handler
- `src/commands/serve.ts` — MCP serve command (dynamic import)
- `src/commands/setup.ts` — Setup command: git root detection, file merging, skill installation
- `src/templates/skill.ts` — Embedded SKILL.md content for the `/review` Claude Code skill

## Running

```bash
npx tsx cli/src/index.ts review --staged
npx tsx cli/src/index.ts serve
npx tsx cli/src/index.ts setup
```
