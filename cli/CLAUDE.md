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

### `diffprism doctor`
- Reports every artifact DiffPrism installs and whether it matches this build: global and project `/review` skill and permissions, `.gitignore`, `.mcp.json` (and what it launches), the pre-commit hook's diffprism block, and the running server (port, PID, uptime, version)
- Read-only. It asks the installers — `setup({ dryRun })`, `hookStatus()`, `decideOnRunningServer()` — rather than keeping its own idea of "current" (#214)
- `--fix` — apply what setup would, refresh a stale hook block, and replace an older server nobody is reviewing in. A server kept up by open reviews is reported, not stopped
- Exits 1 while anything is out of date

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
- `src/commands/pr-agent.ts` — The agent that answers comments on a PR review: one listener, with an `AgentKind` per agent (`CLAUDE`, `CURSOR`) saying how to start a conversation and run one turn. `prAgentStarter()` is what `diffprism server` hands the server to start one per PR review. An agent that only reads runs in a folder of its own and gets the code with `--add-dir` (Cursor with `--workspace`/`--add-dir`), so a PR checkout's `CLAUDE.md`, settings and hooks never load (#257). Only a fixer runs in the repo, its own (#279)
- `src/commands/fix-agent.ts` — The agent a reviewer starts from the dashboard to fix a local review's findings when nothing is waiting to take them (#279). It's `listenWithAgent` with `canEdit: true`. Claude Code may `Edit/Write(./**)` in the repo it runs in, but not `./.git/**`, and has no Bash. Cursor may `Write(<repo>/**)`, but not `<repo>/.git/**`, and has no `Shell`. So neither can commit or run a command, and what they write is in the review. On a staged review, `stagingRunner` lists unstaged and untracked files before each turn (async; the turn starts after), then `stageTurn` stages only what the turn changed. A file that was clean is staged whole. One with the reviewer's unstaged edits gets a `git merge-file` of staged, before and after, written with `update-index`. An overlap, or an untracked file the reviewer hadn't added, fails the fixer with why. `fixAgentStarter()` is what `diffprism server` hands the server for `POST /api/reviews/:id/fixer`
- `src/commands/config.ts` — `diffprism config`: the saved agent and models
- `src/commands/agent-models.ts` — The models each agent can use, from its own CLI (#244): `cursor-agent models`, and the aliases in `claude --help` (Claude Code has no list command). Cached 5 minutes; lookups that overlap share one run, and a failure is remembered for 30 seconds. `agentModelLister()` is what `diffprism server` hands the server for `GET /api/settings/agent/models`
- `src/commands/dojo.ts` — The review dojo (#231): every chosen agent reviews the change — a PR, or a local one such as the commit gate's staged diff (#238) — then votes on the others' findings, over the same `AgentKind`s as the PR agent. `dojoRunner()` is what `diffprism server` hands the server. `DojoRun.stop(reason)` kills every turn in progress, and `result` rejects with `DojoStoppedError` (#252). A turn with no event for `quietLimitMs` (5 min), or `toolQuietLimitMs` (15 min) while a tool call is under way (`AgentKind.toolCalls`), is killed, and its agent drops out; the limit is on silence, not length. `runAgent` starts each agent in its own process group, and `kill()` signals the group, escalating SIGTERM to SIGKILL after `AGENT_KILL_GRACE_MS`, so a turn always ends. The server stops running dojos when it shuts down. An agent whose review is in is `waiting` until voting starts (#251)
- `src/commands/serve.ts` — MCP serve command (dynamic import)
- `src/commands/setup.ts` — Setup command: git root detection, file merging, skill installation, global setup, `isGlobalSetupDone()`
- `src/commands/doctor.ts` — Doctor command: reports the install against this build, `--fix` applies setup
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
