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
- Tell the user: "DiffPrism watch is running — pushed reasoning to the live review."
- Skip the remaining steps

### 1b. Check for Pending Review Feedback

If watch mode is running, call \`mcp__diffprism__get_review_result\` to check for pending review feedback from the developer. If a result is returned:

- **\`approved\`** — Acknowledge approval and continue with your current task.
- **\`approved_with_comments\`** — Note the comments, address any actionable feedback.
- **\`changes_requested\`** — Read the comments carefully, make the requested changes, then push updated reasoning via \`mcp__diffprism__update_review_context\`.

If no pending result, continue normally.

### 2. Check for Configuration

Look for \`diffprism.config.json\` at the project root. If it exists, read it for preferences:

\`\`\`json
{
  "reviewTrigger": "ask | before_commit | always",
  "defaultDiffScope": "staged | unstaged | all",
  "includeReasoning": true | false
}
\`\`\`

**Defaults** (when fields are missing or file doesn't exist):
- \`reviewTrigger\`: \`"ask"\`
- \`defaultDiffScope\`: \`"all"\`
- \`includeReasoning\`: \`true\`

### 3. First-Run Onboarding

If \`diffprism.config.json\` does **not** exist, ask the user these questions before proceeding:

1. **"When should I open DiffPrism reviews?"**
   - \`"ask"\` — Only when you explicitly ask (default)
   - \`"before_commit"\` — Automatically before every commit
   - \`"always"\` — After every code change

2. **"What should the default diff scope be?"**
   - \`"all"\` — All changes, staged and unstaged (default)
   - \`"staged"\` — Only staged changes
   - \`"unstaged"\` — Only unstaged changes

3. **"Should I include my reasoning about the changes in reviews?"**
   - Yes (default)
   - No

After collecting answers, create \`diffprism.config.json\` at the project root with the user's choices. Then proceed to open the review.

### 4. Open the Review

Call \`mcp__diffprism__open_review\` with:

- \`diff_ref\`: Use the \`defaultDiffScope\` from config. If the user specified a scope in their message (e.g., "/review staged"), use that instead.
- \`title\`: A short summary of the changes (generate from git status or the user's message).
- \`description\`: A brief description of what changed and why.
- \`reasoning\`: If \`includeReasoning\` is \`true\`, include your reasoning about the implementation decisions.

### 5. Handle the Result

The tool blocks until the user submits their review in the browser. When it returns:

- **\`approved\`** — Acknowledge and proceed with whatever task was in progress.
- **\`approved_with_comments\`** — Note the comments, address any actionable feedback.
- **\`changes_requested\`** — Read the comments carefully, make the requested changes, and offer to open another review.

### 6. Error Handling

If the \`mcp__diffprism__open_review\` tool is not available:
- Tell the user: "The DiffPrism MCP server isn't configured. Run \`npx diffprism setup\` to set it up, then restart Claude Code."

## Behavior Rules

- When invoked via \`/review\`, always open a review regardless of the \`reviewTrigger\` setting.
- The \`reviewTrigger\` setting only applies to automatic review behavior during other workflows:
  - \`"ask"\` — Never auto-review; only review when the user asks.
  - \`"before_commit"\` — Open a review before creating any git commit.
  - \`"always"\` — Open a review after any code change.
- To re-run onboarding, the user can delete \`diffprism.config.json\` and invoke \`/review\` again.
`;
