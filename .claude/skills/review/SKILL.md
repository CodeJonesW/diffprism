---
name: review
description: Open current code changes in DiffPrism's browser-based review UI for human review.
---

# DiffPrism Review Skill

When the user invokes `/review`, open the current code changes in DiffPrism for browser-based human review.

## Steps

### 1. Check for Watch Mode

Before opening a new review, check if `diffprism watch` is already running. Look for `.diffprism/watch.json` at the git root. If it exists and the process is alive:

- **Do NOT call `open_review`** (the browser is already open with live-updating diffs)
- Instead, call `mcp__diffprism__update_review_context` to push your reasoning to the existing watch session
- Then **immediately** call `mcp__diffprism__get_review_result` with `wait: true` to block until the developer submits their review
- Tell the user: "DiffPrism watch is running — pushed reasoning to the live review. Waiting for your feedback..."
- When the result comes back, handle it per step 5 below
- Skip steps 2-4

### 2. Load Configuration

Look for `diffprism.config.json` at the project root. If it exists, read it for preferences. If it doesn't exist, use defaults silently — do not prompt or create the file.

```json
{
  "reviewTrigger": "ask | before_commit | always",
  "defaultDiffScope": "staged | unstaged | working-copy",
  "includeReasoning": true | false
}
```

**Defaults** (when fields are missing or file doesn't exist):
- `reviewTrigger`: `"ask"`
- `defaultDiffScope`: `"working-copy"`
- `includeReasoning`: `true`

### 3. Open the Review

Call `mcp__diffprism__open_review` with:

- `diff_ref`: Use the `defaultDiffScope` from config. If the user specified a scope in their message (e.g., "/review staged"), use that instead.
- `title`: A short summary of the changes (generate from git status or the user's message).
- `description`: A brief description of what changed and why.
- `reasoning`: If `includeReasoning` is `true`, include your reasoning about the implementation decisions.

### 4. Handle the Result

The tool blocks until the user submits their review in the browser. When it returns:

- **`approved`** — Acknowledge and proceed with whatever task was in progress.
- **`approved_with_comments`** — Note the comments, address any actionable feedback.
- **`changes_requested`** — Read the comments carefully, make the requested changes, and offer to open another review.

### 5. Error Handling

If the `mcp__diffprism__open_review` tool is not available:
- Tell the user: "The DiffPrism MCP server isn't configured. Run `npx diffprism start` to set it up, then restart Claude Code."

## Watch Mode: Waiting for Review Feedback

When `diffprism watch` is active (detected via `.diffprism/watch.json`), the developer can submit reviews at any time in the browser.

**After pushing context to a watch session**, call `mcp__diffprism__get_review_result` with `wait: true` to block until the developer submits their review. This polls the result file every 2 seconds and returns as soon as feedback is available (up to 5 minutes by default).

Use this pattern:
1. Push context via `update_review_context`
2. Call `get_review_result` with `wait: true` — this blocks until the developer submits
3. Handle the result (approved, changes_requested, etc.)
4. If changes were requested, make fixes, push updated context, and call `get_review_result` with `wait: true` again

You can also check for feedback without blocking by calling `get_review_result` without `wait` at natural breakpoints (between tasks, before committing, etc.).

## Behavior Rules

- When invoked via `/review`, always open a review regardless of the `reviewTrigger` setting.
- The `reviewTrigger` setting only applies to automatic review behavior during other workflows:
  - `"ask"` — Never auto-review; only review when the user asks.
  - `"before_commit"` — Open a review before creating any git commit.
  - `"always"` — Open a review after any code change.
- Power users can create `diffprism.config.json` manually to customize defaults.
