export const skillContent = `---
name: review
description: Open current code changes in DiffPrism's browser-based review UI for human review.
---

# DiffPrism Review Skill

When the user invokes \`/review\`, open the current code changes in DiffPrism for browser-based human review.

## Steps

### 1. Check for Watch Mode

Before opening a new review, check if \`diffprism watch\` is already running. Look for \`.diffprism/watch.json\` at the git root. If it exists and the process is alive:

- **Do NOT call \`open_review\`** (the browser is already open with live-updating diffs)
- Instead, call \`mcp__diffprism__update_review_context\` to push your reasoning to the existing watch session
- Then **immediately** call \`mcp__diffprism__get_review_result\` with \`wait: true\` to block until the developer submits their review
- Tell the user: "DiffPrism watch is running — pushed reasoning to the live review. Waiting for your feedback..."
- When the result comes back, handle it per step 5 below
- Skip steps 2-4

### 2. Load Configuration

Look for \`diffprism.config.json\` at the project root. If it exists, read it for preferences. If it doesn't exist, use defaults silently — do not prompt or create the file.

\`\`\`json
{
  "defaultDiffScope": "staged | unstaged | working-copy",
  "includeReasoning": true | false
}
\`\`\`

**Defaults** (when fields are missing or file doesn't exist):
- \`defaultDiffScope\`: \`"working-copy"\`
- \`includeReasoning\`: \`true\`

### 3. Open the Review

Call \`mcp__diffprism__open_review\` with:

- \`diff_ref\`: Use the \`defaultDiffScope\` from config. If the user specified a scope in their message (e.g., "/review staged"), use that instead.
- \`title\`: A short summary of the changes (generate from git status or the user's message).
- \`description\`: A brief description of what changed and why.
- \`reasoning\`: If \`includeReasoning\` is \`true\`, include your reasoning about the implementation decisions.

### 4. Handle the Result

The tool blocks until the user submits their review in the browser. When it returns:

- **\`approved\`** — Acknowledge and proceed with whatever task was in progress.
- **\`approved_with_comments\`** — Note the comments, address any actionable feedback.
- **\`changes_requested\`** — Read the comments carefully, make the requested changes, and offer to open another review.

#### Post-Review Actions

The result may include a \`postReviewAction\` field. If present, **execute the action immediately without asking for confirmation** — the user already chose this action in the review UI:

- **\`"commit"\`** — Commit the reviewed changes (stage relevant files, create a commit with an appropriate message).
- **\`"commit_and_pr"\`** — Commit the changes and open a pull request.

If \`postReviewAction\` is not present or is empty, do nothing extra — just report the result.

### 5. Error Handling

If the \`mcp__diffprism__open_review\` tool is not available:
- Tell the user: "The DiffPrism MCP server isn't configured. Run \`npx diffprism setup\` to set it up, then restart Claude Code."

## Global Server Mode

When a global DiffPrism server is running (\`diffprism server\`), the MCP tools automatically detect it and route reviews there instead of opening a new browser tab each time. The review appears in the server's multi-session UI at the existing browser tab.

This is transparent — the same \`open_review\`, \`update_review_context\`, and \`get_review_result\` tools work the same way. No changes to the workflow are needed.

## Watch Mode: Waiting for Review Feedback

When \`diffprism watch\` is active (detected via \`.diffprism/watch.json\`), the developer can submit reviews at any time in the browser.

**After pushing context to a watch session**, call \`mcp__diffprism__get_review_result\` with \`wait: true\` to block until the developer submits their review. This polls the result file every 2 seconds and returns as soon as feedback is available (up to 5 minutes by default).

Use this pattern:
1. Push context via \`update_review_context\`
2. Call \`get_review_result\` with \`wait: true\` — this blocks until the developer submits
3. Handle the result (approved, changes_requested, etc.)
4. If changes were requested, make fixes, push updated context, and call \`get_review_result\` with \`wait: true\` again

You can also check for feedback without blocking by calling \`get_review_result\` without \`wait\` at natural breakpoints (between tasks, before committing, etc.).

## Self-Review: Headless Analysis Tools

DiffPrism provides two headless tools that return analysis data as JSON without opening a browser. Use these to check your own work before requesting human review.

### Available Headless Tools

- **\`mcp__diffprism__get_diff\`** — Returns a structured \`DiffSet\` (files, hunks, additions/deletions) for a given diff ref. Use this to inspect exactly what changed.
- **\`mcp__diffprism__analyze_diff\`** — Returns a \`ReviewBriefing\` with summary, file triage, impact detection, complexity scores, test coverage gaps, and pattern flags (security issues, TODOs, console.logs left in, etc.).

Both accept a \`diff_ref\` parameter: \`"staged"\`, \`"unstaged"\`, \`"working-copy"\`, or a git range like \`"HEAD~3..HEAD"\`.

### Self-Review Loop

When you've finished writing code and before requesting human review, use this pattern:

1. **Analyze your changes:** Call \`mcp__diffprism__analyze_diff\` with \`diff_ref: "working-copy"\`
2. **Check the briefing for issues:**
   - \`patterns\` — Look for console.logs, TODOs, security flags, disabled tests
   - \`testCoverage\` — Check if changed source files have corresponding test changes
   - \`complexity\` — Review high-complexity scores
   - \`impact.newDependencies\` — Verify any new deps are intentional
   - \`impact.breakingChanges\` — Confirm breaking changes are expected
3. **Fix any issues found** — Remove debug statements, add missing tests, address security flags
4. **Re-analyze** — Run \`analyze_diff\` again to confirm the issues are resolved
5. **Open for human review** — Once clean, use \`/review\` or \`open_review\` for final human sign-off

This loop catches common issues (leftover console.logs, missing tests, security anti-patterns) before the human reviewer sees them, making reviews faster and more focused.

### When to Use Headless Tools

- **After completing a coding task** — Self-check before requesting review
- **During implementation** — Periodically check for patterns and issues as you work
- **Before committing** — Quick sanity check on what's about to be committed
- **Do NOT use these as a replacement for human review** — They complement, not replace, \`/review\`

## Behavior Rules

- **IMPORTANT: Do NOT open reviews automatically.** Only open a review when the user explicitly invokes \`/review\` or directly asks for a review.
- Do NOT open reviews before commits, after code changes, or at any other time unless the user requests it.
- Headless tools (\`get_diff\`, \`analyze_diff\`) can be used proactively during development without explicit user request — they don't open a browser or interrupt the user.
- Power users can create \`diffprism.config.json\` manually to customize defaults (diff scope, reasoning).
`;
