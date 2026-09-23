# DiffPrism CLI

Commander-based CLI entry point. Thin wrapper around core pipeline.

## Commands

### `diffprism review [ref]`
- `--staged` — Review staged changes (default if no ref)
- `--unstaged` — Review unstaged changes
- `-t, --title <title>` — Set review title
- `--reasoning <text>` — What the change was for, shown as the session's subtitle
- Ref can be any git range: `HEAD~3..HEAD`, `main..feature`, etc.
- Opens browser, blocks until review submitted, prints JSON result to stdout
- A GitHub PR (`owner/repo#123` or a PR URL) opens a PR review instead, without blocking. `--title` and `--reasoning` apply to it too.

### `diffprism serve`
- Starts MCP server (dynamically imports @diffprism/mcp-server)
- Connects StdioServerTransport for Claude Code integration

### `diffprism setup`
- Configures DiffPrism for Claude Code integration in one command
- Creates/merges `.mcp.json` with DiffPrism MCP server entry
- Creates/merges `.claude/settings.json` with auto-approve permission for `open_review`
- Installs `/review` skill to `.claude/skills/review/SKILL.md`
- `--global` — Configure globally (skill + permissions at `~/.claude/`, no git repo required)
- `--force` — Overwrite existing configuration files
- Idempotent: skips files that are already correctly configured
- Upgrades what older versions wrote: prunes permissions for retired tools, and removes hooks that call DiffPrism commands which no longer exist (`notify-stop`, #215)

### `diffprism teardown`
- Removes DiffPrism configuration from the current project in one command
- Reverses all changes made by `diffprism setup`: `.mcp.json`, permissions, skill, `.gitignore`, `.diffprism/`
- `--global` — Remove global configuration (skill + permissions at `~/.claude/`)
- `-q, --quiet` — Suppress output
- Safely handles partial configs: skips items that don't exist, preserves non-DiffPrism entries
- Also removes hooks older versions installed for commands that no longer exist

### `diffprism server`
- Starts the global DiffPrism server for multi-session reviews
- HTTP API on port 24680 (default), WebSocket on port 24681
- Auto-runs `diffprism setup --global` if not already done
- `-p, --port <port>` — Custom HTTP port
- `--ws-port <port>` — Custom WebSocket port
- Subcommands: `server status`, `server stop`

## Key Files

- `src/index.ts` — Entry point: `createProgram().parse()`
- `src/program.ts` — `createProgram()`: Commander setup and routing, without parsing (the docs check introspects it)
- `src/commands/review.ts` — Review command handler
- `src/commands/serve.ts` — MCP serve command (dynamic import)
- `src/commands/setup.ts` — Setup command: git root detection, file merging, skill installation, global setup, `isGlobalSetupDone()`
- `src/commands/teardown.ts` — Teardown command: reverses setup by removing DiffPrism config from all locations
- `src/commands/server.ts` — Global server start/status/stop
- `src/templates/skill.ts` — Embedded SKILL.md content for the `/review` Claude Code skill

## Running

```bash
npx tsx cli/src/index.ts review --staged
npx tsx cli/src/index.ts serve
npx tsx cli/src/index.ts setup
npx tsx cli/src/index.ts server
```
