---
name: review
description: Open current code changes in DiffPrism's browser-based review UI for human review.
---

# DiffPrism Review

You have 14 DiffPrism MCP tools available. Use them proactively — don't wait for the user to ask.

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

## Workflow 3: PR Super Review

When the user opens a GitHub PR for review (via `diffprism review <PR URL>` or the DiffPrism UI), you become their AI-powered code reviewer. The diff is visible in the browser; you provide the intelligence.

### Getting oriented
1. Call `mcp__diffprism__get_pr_context` to understand the PR: title, author, branches, file list, briefing summary, and whether a local repo is connected.

### Investigating changes
2. Call `mcp__diffprism__get_file_diff` for specific files to see their hunks and triage category (critical/notable/mechanical).
3. Call `mcp__diffprism__get_file_context` to read full files from the local repo — this gives you surrounding code, not just diff hunks. Use this to understand how changed code fits into the broader file.
4. Call `mcp__diffprism__get_user_focus` to see what file/line the user is currently viewing in the browser. Proactively offer context about what they're looking at.

### Leaving findings
5. Call `mcp__diffprism__add_review_comment` to post findings directly to the browser UI. Comments appear as inline annotations on the diff in real-time. Use this to flag issues, suggest improvements, or answer the user's questions visually.
6. Call `mcp__diffprism__get_review_comments` to see what's already been noted before adding your own.

### Key principle
The user sees the diff in the browser. You see it through MCP tools. Work together — they spot visual patterns, you analyze logic and context.

## Tool Reference

### Review Lifecycle
| Tool | Purpose |
|------|---------|
| `open_review` | Open browser review UI for local changes or a GitHub PR. |
| `get_review_result` | Fetch result from a previous review. |
| `update_review_context` | Push updated reasoning/description to a running review session. |

### Headless Analysis
| Tool | Purpose |
|------|---------|
| `analyze_diff` | Returns analysis JSON (patterns, complexity, test gaps) without opening a browser. |
| `get_diff` | Returns structured diff JSON (file-level and hunk-level changes). |

### PR Super Review
| Tool | Purpose |
|------|---------|
| `get_pr_context` | High-level PR overview: metadata, briefing, file list, local repo status. |
| `get_file_diff` | Diff hunks for a specific file with triage category. |
| `get_file_context` | Full file content from local repo via `git show`. |
| `get_user_focus` | What file/line the user is currently viewing in the browser UI. |

### Annotation & Commenting
| Tool | Purpose |
|------|---------|
| `add_review_comment` | Post a comment that appears inline in the browser diff. |
| `get_review_comments` | Read all comments and annotations on the session. |
| `add_annotation` | Post a structured finding (finding/suggestion/question/warning). |
| `flag_for_attention` | Mark files for human attention with warning annotations. |
| `get_review_state` | Get current state of a review session including all annotations. |

## Rules

- **Self-review is proactive** — run `analyze_diff` after significant changes without being asked.
- **Human review requires explicit request** — only open `open_review` when the user asks (`/review`, "review my changes", or as part of a defined workflow like PR creation).
- **Annotate generously** — the more context you provide in annotations, the faster the reviewer can make decisions.
- **PR review is conversational** — when a PR is open, use the super review tools to answer questions and post findings without being asked to use specific tools.
