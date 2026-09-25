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
- A GitHub PR (`owner/repo#123` or a PR URL) opens a PR review instead. `--title` and `--reasoning` apply to it too.
- For a PR, the server starts a headless, read-only agent — Claude Code unless `diffprism config` or the dashboard says otherwise — that answers the reviewer's comments until the review is submitted, for PRs opened from the dashboard too (`src/commands/pr-agent.ts`, #217, #224, #226). The command returns once the review is open and prints the command that resumes the agent's conversation. If the server can't start one (not installed, not logged in, unreadable settings), it says why when it can and prints the prompt to paste.
- `--agent <claude|cursor>`, `--model <model>` — for a PR, the agent and model that answer comments this time, over the saved default (#226)
- `--no-agent` — open the PR review without starting one

### `diffprism config`
- Which agent answers PR reviews by default, and a model per agent, saved in `~/.diffprism/config.json` — the file the dashboard's Review agent settings also write (#226)
- `config get [key]`, `config set <key> <value>`, `config unset <key>`; keys `agent`, `claude.model`, `cursor.model`
- Refuses an unknown agent or key with exit code 1

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
- `src/commands/pr-agent.ts` — The agent that answers comments on a PR review: one listener, with an `AgentKind` per agent (`CLAUDE`, `CURSOR`) saying how to start a conversation and run one turn. `prAgentStarter()` is what `diffprism server` hands the server to start one per PR review
- `src/commands/config.ts` — `diffprism config`: the saved agent and models
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
