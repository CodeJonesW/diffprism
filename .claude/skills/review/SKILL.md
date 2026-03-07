---
name: review
description: Open current code changes in DiffPrism's browser-based review UI for human review.
---

# DiffPrism Review

You have 9 DiffPrism MCP tools available. Use them proactively — don't wait for the user to ask.

## Workflow 1: Self-Review Before Human Review

After making multi-file changes, **proactively self-review before requesting human review**:

1. Run `mcp__diffprism__analyze_diff` with `diff_ref: "working-copy"`
2. Check the response for:
   - **Pattern flags** — console.logs left in, TODO comments, security issues (hardcoded secrets, SQL injection, XSS)
   - **Test coverage gaps** — new code paths without corresponding tests
   - **High complexity scores** — functions or files with elevated complexity
3. **Fix any issues found** — remove debug logs, add missing tests, simplify complex code
4. Only then open a human review with `mcp__diffprism__open_review`

This should happen automatically after significant changes. You don't need the user to ask.

## Workflow 2: Annotated Human Review

When opening a review, help the reviewer by flagging what matters:

1. Call `mcp__diffprism__open_review` with:
   - `diff_ref`: `"working-copy"` (or what the user specified, e.g. `"staged"`, `"HEAD~3..HEAD"`)
   - `title`: Brief summary of the changes
   - `reasoning`: Your reasoning about implementation decisions
   - `annotations`: Array of inline findings to pre-populate the review (see tool schema)
2. Use annotations to flag:
   - Areas of uncertainty ("I chose approach X over Y because...")
   - Security-sensitive changes
   - Performance implications
   - Anything the reviewer should look at closely
3. After opening, use `mcp__diffprism__flag_for_attention` to highlight files that need careful review (e.g. auth logic, data migrations, public API changes)
4. Use `mcp__diffprism__add_annotation` to post additional findings about specific lines if you discover issues while the review is open

Handle the review result:
- **`approved`** — Proceed with the task.
- **`changes_requested`** — Read comments, make fixes, offer to re-review.
- If `postReviewAction` is `"commit"` — commit the changes.
- If `postReviewAction` is `"commit_and_pr"` — commit and open a PR.

## Workflow 3: PR Review

To review a GitHub pull request:

1. Call `mcp__diffprism__review_pr` with `pr: "owner/repo#123"` or a full GitHub PR URL
2. Set `post_to_github: true` to post the review back to GitHub after the human submits
3. The tool fetches the PR diff, runs analysis, and opens the review UI

## Tool Reference

### Review Lifecycle
| Tool | Purpose |
|------|---------|
| `open_review` | Open browser review UI for local changes. Blocks until submitted. |
| `review_pr` | Open browser review UI for a GitHub PR. Blocks until submitted. |
| `get_review_result` | Fetch result from a previous review (advanced — `open_review` already returns it). |
| `update_review_context` | Push updated reasoning/description to a running review session. |

### Headless Analysis
| Tool | Purpose |
|------|---------|
| `analyze_diff` | Returns analysis JSON (patterns, complexity, test gaps) without opening a browser. |
| `get_diff` | Returns structured diff JSON (file-level and hunk-level changes). |

### Annotation & Flagging
| Tool | Purpose |
|------|---------|
| `add_annotation` | Post a finding/suggestion/question on a specific line in a running review. |
| `flag_for_attention` | Mark files for human attention with warning annotations. |
| `get_review_state` | Get current state of a review session including all annotations. |

## Rules

- **Self-review is proactive** — run `analyze_diff` after significant changes without being asked.
- **Human review requires explicit request** — only open `open_review` when the user asks (`/review`, "review my changes", or as part of a defined workflow like PR creation).
- **Annotate generously** — the more context you provide in annotations, the faster the reviewer can make decisions.
