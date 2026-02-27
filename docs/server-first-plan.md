# DiffPrism: Server-First Architecture Plan

**Date:** 2026-02-27
**Context:** [Product Plan Discussion](./product-plan-discussion-2026-02-27.md)

---

## The Shift

Today DiffPrism has three modes (ephemeral, watch, global server) that all run different code paths, and an MCP+skill layer that requires the model to orchestrate a multi-step flow. The model is the weakest link.

The new architecture has **one mode: the server.** Every review goes through the same HTTP API. Every client — MCP, CLI, SDK, git hook — is a thin adapter that POSTs to that API. The server handles watching, session management, browser lifecycle, and result delivery. The model's only job is to call one tool.

### Current Architecture

```
Agent calls open_review (MCP)
  ├─ Is global server running? → POST /api/reviews, poll for result
  ├─ Is watch mode running? → update_review_context + get_review_result
  └─ Neither? → Spin up ephemeral Vite + WS + HTTP, open browser, block, teardown
```

Three code paths. Three discovery mechanisms. A 130-line skill file to teach the model which path to take.

### Target Architecture

```
Agent calls review tool
  └─ POST /api/reviews → server handles everything → result returned
```

One code path. One server. The model calls one tool.

---

## Phase 0: Server Always Running

**Goal:** Make the DiffPrism server a background daemon that's always available. Eliminate the "is the server running?" question.

### What to build

1. **Auto-start on first use.** When any client (CLI, MCP) tries to reach the server and it's not running, start it automatically in the background. No manual `diffprism server` required.

   ```
   CLI: diffprism review --staged
     → isServerAlive()? No
     → spawn("diffprism", ["server", "--background"])
     → wait for server.json to appear (with timeout)
     → POST /api/reviews
   ```

2. **Background daemon mode.** `diffprism server --background` (or `--daemon`) detaches from the terminal. Writes PID to `~/.diffprism/server.json` (already done). Logs to `~/.diffprism/server.log`.

3. **Auto-start in MCP.** The MCP `open_review` tool does the same: if no server, start one. This means ephemeral mode is no longer needed — the first review just takes 1-2 seconds longer while the server boots.

4. **Lifecycle management.** `diffprism server stop` already works. Add `diffprism server restart`. Consider auto-shutdown after N minutes of inactivity (configurable, default: never for explicit start, 30 min for auto-started).

### What to remove

- **Ephemeral mode code path** in `pipeline.ts`. The `startReview()` function that spins up per-review Vite + WS + HTTP servers becomes unnecessary. The pipeline module can be simplified to just "ensure server is running, POST review, return result."
- **Watch mode as a separate entry point.** `startWatch()` in `watch.ts` creates its own WatchBridge, DiffPoller, and UI server. All of this is already in the global server. Watch behavior becomes a server feature, not a separate mode.

### What to keep

- `global-server.ts` — this IS the server now. Rename to `server.ts`.
- `server-file.ts` — discovery mechanism is solid.
- `diff-poller.ts` — reused by the server for live watching.
- `watch-bridge.ts` — the HTTP+WS bridge is the server's internal transport. May merge into server.ts or keep as internal module.

### Migration path

The global server already does everything ephemeral and watch mode do, plus more. The migration is:

1. Add `--background` / `--daemon` flag to `diffprism server`
2. Add auto-start logic to a shared `ensureServer()` utility
3. Wire `ensureServer()` into CLI `review` command and MCP `open_review`
4. Once auto-start works, deprecate `startReview()` and `startWatch()` as public APIs
5. Remove `watch.json` discovery — everything goes through `server.json`
6. Remove `WatchBridge` as a standalone module (its HTTP routes merge into server)

---

## Phase 1: Watch by Default

**Goal:** The server automatically watches repos with active sessions. The review surface is always current. Agents don't need to trigger updates.

### What to build

1. **Session-scoped watching.** When a session is created via `POST /api/reviews` with a `projectPath` and `diffRef`, the server starts a DiffPoller for that repo. This already happens — the global server creates watchers when WS clients connect. Change: start watching immediately on session creation, not on WS connect.

2. **Multi-repo watching.** The server tracks one poller per `(projectPath, diffRef)` pair. Already implemented via `sessionWatchers` map in `global-server.ts`. No new code needed — just make it the default behavior.

3. **UI always shows current state.** The browser tab is always open (or reopens on new session). The UI shows the latest diff for whatever session is selected. Already works — just needs to be the primary workflow, not an alternative to ephemeral.

4. **Agent context push is optional enrichment.** The agent can POST reasoning/title/description to `/api/reviews/:id/context` at any time. The review surface works without it — the diff is already there from watching. Agent context just makes the review richer.

### What changes for the user

**Before:** Agent finishes coding → agent calls `open_review` → browser opens → human reviews.

**After:** Server is watching the repo → human sees changes appearing in real time → agent optionally pushes reasoning → human reviews when ready.

The review trigger shifts from "agent calls tool" to "code changes on disk." The agent's role changes from "orchestrate the review" to "optionally annotate the review."

### CLI changes

- `diffprism review` → Ensures server is running, creates/updates session for cwd, opens browser if not already open. Simple trigger, not a blocking pipeline.
- `diffprism watch` → Alias for `diffprism review` (or deprecated). The server always watches.
- `diffprism start` → Alias for `diffprism server` with auto-setup. Possibly becomes the primary entry point.

---

## Phase 2: Simplify Agent Integration

**Goal:** The model calls one tool. No skill file orchestration. No mode detection.

### MCP: Collapse to essentials

The MCP server currently has 8 tools. Agents reliably use simple tools. Reduce cognitive load:

**Keep as-is:**
- `open_review` — The primary tool. Internally: ensure server → POST review → poll result. Rename consideration: just `review`.
- `analyze_diff` — Headless analysis. Already simple.
- `get_diff` — Headless diff. Already simple.

**Merge into `open_review`:**
- `update_review_context` — Make this a parameter on `open_review` or automatic. If the server is watching and the agent calls `open_review`, the reasoning gets attached to the existing session.
- `get_review_result` — The blocking poll is already inside `open_review`. This tool only exists for watch mode's split flow. With watch-by-default, the split flow disappears.

**Keep but simplify:**
- `add_annotation` — Useful for multi-agent review (Posture 3). Keep, but make `session_id` optional (default to most recent session).
- `get_review_state` — Useful for agents checking review status. Keep.
- `flag_for_attention` — Useful. Keep.
- `review_pr` — GitHub PR review. Keep.

**Target: 3 tools an agent needs to know about:**
1. `open_review` — "Review my changes" (blocks until human decides)
2. `analyze_diff` — "Check my work" (returns analysis JSON)
3. `get_diff` — "Show me what changed" (returns diff JSON)

The other tools (add_annotation, get_review_state, flag_for_attention, review_pr) exist for advanced use cases but agents don't need to know about them to do basic review.

### Skill file: Radically simplify

The current skill is 130 lines covering watch mode detection, config loading, multi-step flows, self-review loops. Replace with:

```markdown
When the user invokes `/review`, call `open_review` with:
- `diff_ref`: "working-copy" (or what the user specified)
- `title`: Brief summary of changes
- `reasoning`: Your reasoning about the implementation

The tool blocks until the human submits. Handle the result:
- "approved" → Proceed
- "changes_requested" → Read comments, fix, offer to re-review
- If `postReviewAction` is "commit" → Commit the changes
- If `postReviewAction` is "commit_and_pr" → Commit and open PR
```

~15 lines. No conditionals. No mode detection. No config loading. The tool handles everything.

### Alternative: Claude Code hooks instead of skills

Claude Code hooks execute shell commands on specific events. Instead of a skill that the model must choose to follow:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "command": "curl -s -X POST http://localhost:24680/api/notify -d '{\"event\":\"file_changed\",\"cwd\":\"$PWD\"}'"
      }
    ]
  }
}
```

The server gets notified of file changes automatically. No model involvement. The review surface stays current without the agent doing anything.

This is more aggressive than simplifying the skill — it removes the model from the loop entirely for triggering updates. The skill still exists for explicit `/review` invocations (blocking review with decision flow back to agent).

---

## Phase 3: Agent SDK

**Goal:** Any agent framework can integrate DiffPrism with a library import. MCP becomes one client implementation, not the only one.

### Package: `@diffprism/agent`

```typescript
import { DiffPrism } from "@diffprism/agent"

// Auto-discovers server, auto-starts if needed
const dp = new DiffPrism()

// Headless analysis (Posture 2: self-review)
const briefing = await dp.analyze("working-copy")
// → ReviewBriefing { summary, triage, patterns, complexity, ... }

// Open human review (Posture 1: blocks until decision)
const result = await dp.review("working-copy", {
  title: "Refactored auth middleware",
  reasoning: "Consolidated duplicate token validation logic"
})
// → ReviewResult { decision, comments, summary, postReviewAction }

// Get structured diff
const diff = await dp.getDiff("staged")
// → DiffSet { files: [...] }

// Post annotation to active session (Posture 3: agent as reviewer)
await dp.annotate(sessionId, {
  file: "src/auth.ts",
  line: 42,
  body: "This bypasses rate limiting",
  type: "finding",
  category: "security"
})

// Check session state
const state = await dp.getSession(sessionId)
```

### Implementation

The SDK is a typed HTTP client over the server API:

```typescript
export class DiffPrism {
  private baseUrl: string

  constructor(options?: { port?: number }) {
    // Read ~/.diffprism/server.json for port
    // If server not running, auto-start
    this.baseUrl = `http://localhost:${port}`
  }

  async analyze(ref: string): Promise<ReviewBriefing> {
    // Could call server API, or compute locally
    // Local is faster (no HTTP roundtrip), but requires git access
    // Server is more portable (works in containers without git)
  }

  async review(ref: string, opts?: ReviewOptions): Promise<ReviewResult> {
    // POST /api/reviews with diff + analysis
    // Poll /api/reviews/:id/result until submitted
    // Return result
  }

  async getDiff(ref: string): Promise<DiffSet> {
    // Compute locally with @diffprism/git
    // Or GET from server if we add that endpoint
  }
}
```

### MCP server becomes an SDK consumer

```typescript
// packages/mcp-server/src/index.ts — simplified
import { DiffPrism } from "@diffprism/agent"

const dp = new DiffPrism()

server.tool("open_review", schema, async ({ diff_ref, title, reasoning }) => {
  const result = await dp.review(diff_ref, { title, reasoning })
  return { content: [{ type: "text", text: JSON.stringify(result) }] }
})

server.tool("analyze_diff", schema, async ({ diff_ref }) => {
  const briefing = await dp.analyze(diff_ref)
  return { content: [{ type: "text", text: JSON.stringify(briefing) }] }
})
```

The MCP server drops from 1100 lines to ~100. All logic lives in the SDK. All routing lives in the server.

---

## Phase 4: Multi-Client Ecosystem

**Goal:** DiffPrism works with any agent or workflow, not just Claude Code.

### Integration points (all thin clients over the HTTP API)

| Client | Trigger | Implementation |
|--------|---------|----------------|
| Claude Code MCP | Model calls `open_review` | SDK wrapping HTTP API |
| Claude Code hook | Model edits files | Shell command POSTs to server |
| CLI | `diffprism review` | SDK wrapping HTTP API |
| Git hook | `git push` / `git commit` | Shell script POSTs to server |
| VS Code extension | Button click / command | SDK wrapping HTTP API |
| Cursor / Windsurf | Agent finishes task | SDK or HTTP POST |
| CI pipeline | PR opened | HTTP POST with diff payload |
| Custom agent (Agent SDK) | Agent calls `dp.review()` | SDK directly |

### What this means for setup

`diffprism setup` simplifies:

1. Ensure server is running (or will auto-start)
2. For Claude Code: register MCP server in `.mcp.json` (existing)
3. For Claude Code: install simplified skill (existing, but smaller)
4. Optionally: install git hooks for auto-review on push
5. Optionally: install Claude Code hooks for live updates

The setup is still one command. The output is simpler because there's less to configure.

---

## What Gets Deleted

| Current Code | Reason |
|-------------|--------|
| `packages/core/src/pipeline.ts` (`startReview()`) | Replaced by "ensure server + POST review" |
| `packages/core/src/watch.ts` (`startWatch()`) | Watch behavior moves into server |
| `packages/core/src/watch-bridge.ts` (standalone) | HTTP+WS routes merge into server |
| `packages/core/src/watch-file.ts` | No more `.diffprism/watch.json` — everything uses `server.json` |
| `packages/core/src/ws-bridge.ts` | Legacy single-client bridge, replaced by server WS |
| `cli/src/commands/watch.ts` | `watch` becomes alias or deprecated |
| `cli/src/commands/start.ts` | `start` becomes alias for `server` |
| Skill file (130 lines) | Replaced by ~15 line version |

### Lines of code removed (estimated)

- `pipeline.ts`: ~200 lines
- `watch.ts`: ~150 lines
- `watch-bridge.ts`: ~250 lines
- `watch-file.ts`: ~80 lines
- `ws-bridge.ts`: ~150 lines
- CLI commands: ~100 lines
- Skill template: ~115 lines
- MCP server simplification: ~800 lines → ~100 lines

**~1,850 lines removed.** Replaced by:
- `ensureServer()` utility: ~50 lines
- `@diffprism/agent` SDK: ~200 lines
- Simplified MCP server: ~100 lines
- Simplified skill: ~15 lines
- Daemon support in server: ~50 lines

**Net reduction: ~1,400 lines** while gaining a cleaner architecture.

---

## Execution Order

### Sprint 1: Foundation (Phase 0)
- [ ] Add `--background` daemon mode to `diffprism server`
- [ ] Create `ensureServer()` utility (start server if not running)
- [ ] Wire `ensureServer()` into CLI `review` command
- [ ] Wire `ensureServer()` into MCP `open_review`
- [ ] Test: `diffprism review --staged` works without manual server start
- [ ] Test: MCP `open_review` works without manual server start

### Sprint 2: Consolidation (Phase 0 + 1)
- [ ] Remove `startReview()` ephemeral pipeline (route through server)
- [ ] Remove `startWatch()` standalone watch (server watches by default)
- [ ] Remove `watch-bridge.ts`, `watch-file.ts`, `ws-bridge.ts`
- [ ] Remove/alias CLI `watch` and `start` commands
- [ ] Start DiffPoller on session creation (not on WS connect)
- [ ] Test: all existing workflows still work through the server

### Sprint 3: Agent Simplification (Phase 2)
- [ ] Simplify skill file to ~15 lines
- [ ] Merge `update_review_context` into `open_review` session reuse
- [ ] Merge `get_review_result` polling into `open_review` blocking
- [ ] Evaluate Claude Code hooks for automatic file-change notifications
- [ ] Test: model successfully calls review with no steering

### Sprint 4: SDK (Phase 3)
- [ ] Create `packages/agent/` with `DiffPrism` class
- [ ] Implement `analyze()`, `review()`, `getDiff()`, `annotate()`, `getSession()`
- [ ] Refactor MCP server to use SDK internally
- [ ] Publish `@diffprism/agent` package
- [ ] Test: custom agent script can import SDK and run review

### Sprint 5: Ecosystem (Phase 4)
- [ ] Git hook integration (`diffprism setup --git-hooks`)
- [ ] Claude Code hook integration (optional file-change notifications)
- [ ] Document HTTP API for third-party integrations
- [ ] Update `diffprism setup` for simplified config

---

## Success Criteria

1. **Zero-steering reviews:** Model calls `open_review`, review happens, result returns. No skill debugging. No "try /review again."
2. **One server, always available:** No more "is the server running?" No more ephemeral mode. `diffprism review` just works.
3. **Framework-agnostic:** A Python script can `POST /api/reviews` and get a review. No MCP required.
4. **Net code reduction:** Fewer lines, fewer modules, fewer code paths. The architecture is simpler, not more complex.
5. **Existing UX preserved:** The review UI, analysis engine, and browser experience are unchanged. Only the plumbing changes.

---

## Open Risks

1. **Daemon reliability.** Background processes can die, get orphaned, or conflict. Need robust PID management and health checks. (Partially solved — `server-file.ts` already does PID + HTTP health checks.)
2. **Port conflicts.** Auto-starting a server on port 24680 may conflict. Need graceful fallback or user-configurable ports.
3. **Cold start latency.** First review after boot takes 1-2s to start server + Vite. Acceptable? Consider pre-building UI for production (static serve instead of Vite dev server).
4. **MCP tool removal.** Reducing from 8 to 3 primary tools is a breaking change for any agents that use the removed tools. Need deprecation period or keep them as thin wrappers.
5. **Watch overhead.** Polling every 2s across multiple repos. For repos with large diffs, this could be heavy. Already mitigated by hash-based change detection (only re-analyzes when diff hash changes).
