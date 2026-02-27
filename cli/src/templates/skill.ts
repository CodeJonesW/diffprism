export const skillContent = `---
name: review
description: Open current code changes in DiffPrism's browser-based review UI for human review.
---

# DiffPrism Review

When the user invokes \`/review\`, call \`mcp__diffprism__open_review\` with:

- \`diff_ref\`: \`"working-copy"\` (or what the user specified, e.g. \`"staged"\`)
- \`title\`: Brief summary of the changes
- \`reasoning\`: Your reasoning about the implementation decisions

The tool blocks until the human submits their review. Handle the result:

- **\`approved\`** — Proceed with the task.
- **\`changes_requested\`** — Read comments, make fixes, offer to re-review.
- If \`postReviewAction\` is \`"commit"\` — commit the changes.
- If \`postReviewAction\` is \`"commit_and_pr"\` — commit and open a PR.

## Headless Tools

- \`mcp__diffprism__analyze_diff\` — Returns analysis JSON (patterns, complexity, test gaps) without opening a browser. Use proactively to self-check before requesting review.
- \`mcp__diffprism__get_diff\` — Returns structured diff JSON.

## Rules

- Only open a review when the user explicitly asks (\`/review\` or "review my changes").
- Headless tools can be used proactively without user request.
`;
