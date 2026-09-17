export const skillContent = `---
name: review
description: Open current code changes in DiffPrism's browser-based review UI for human review.
---

# DiffPrism Review

You have 14 DiffPrism MCP tools. Use the analysis tools proactively; open a human review only when asked.

## How reviews work

- **One review per repo.** Opening a review for a repo that already has one updates it — new diff, same session, existing annotations kept. A git worktree is its own repo.
- **\`open_review\` waits for the decision.** It blocks until the reviewer approves, requests changes, or dismisses, and returns their \`ReviewResult\`. Pass \`wait: false\` to get the session id back immediately instead.
- **Scope defaults to the working copy everywhere.** \`open_review\`, \`get_diff\` and \`analyze_diff\` all review \`"working-copy"\` unless you pass \`diff_ref\` — the same default as \`diffprism review\` and the dashboard, so your self-review and the human review look at the same changes.
- **A decision stands while its diff is unchanged.** If your wait is cut short, open the same review again or re-run the same commit and you get the decision the reviewer already gave — not a second review request. Change the diff and it becomes a new question.
- **Tools act on the review for your repo.** Every tool that works on an open review takes \`session_id\` or \`repo_path\`, and otherwise uses the repo you are running in. If that is ambiguous the tool says so and lists the sessions — pass \`session_id\`. It never guesses.

## Workflow 1: Self-Review Before Human Review

After making multi-file changes, **proactively self-review before requesting human review**:

1. Run \`mcp__diffprism__analyze_diff\` (it covers the working copy by default)
2. Check the response for:
   - **Pattern flags** — console.logs left in, TODO comments, security issues (hardcoded secrets, SQL injection, XSS)
   - **Test coverage gaps** — new code paths without corresponding tests
   - **High complexity scores** — functions or files with elevated complexity
3. **Fix any issues found** — remove debug logs, add missing tests, simplify complex code
4. Only then open a human review

This should happen automatically after significant changes. You don't need the user to ask.

## Workflow 2: Annotated Human Review

1. Call \`mcp__diffprism__open_review\` with:
   - \`diff_ref\`: omit it for the working copy, or pass what the user asked for — see *Choosing a scope*
   - \`title\`: Brief summary of the changes
   - \`reasoning\`: What you were trying to accomplish — this is how the reviewer tells sessions apart
   - \`annotations\`: Findings to show when the review opens
2. Annotate what matters:
   - Areas of uncertainty ("I chose approach X over Y because...")
   - Security-sensitive changes
   - Performance implications
   - Use \`type: "warning"\` for anything the reviewer must look at — warnings flag the session in the sidebar
3. \`open_review\` returns the decision when the reviewer submits:
   - **\`approved\`** / **\`approved_with_comments\`** — proceed. Read any comments or summary.
   - **\`changes_requested\`** — read the \`summary\` and \`comments\`, make the fixes, and offer to re-review.
   - **\`dismissed\`** — the reviewer closed it without deciding. Ask before continuing.
   - If \`postReviewAction\` is \`"commit"\` — commit the changes. If \`"commit_and_pr"\` — commit and open a PR.
4. If it returns \`status: "timed_out"\`, the reviewer is still reading. Keep waiting with \`mcp__diffprism__get_review_result\` (\`wait: true\`).
5. If it returns \`status: "reviewer_asked"\`, the reviewer asked you something before deciding. Answer each thread with \`mcp__diffprism__reply\` (its \`id\` is the \`annotation_id\`) — and change the code if that's what they asked for. Then wait again with \`mcp__diffprism__get_review_result\` (\`wait: true\`), which can return \`reviewer_asked\` again.

**While a review is open, wait for it.** Don't ask the user whether they've finished, and don't move on to other work — their decision is the answer, and it arrives through the tool. Asking in the terminal splits the conversation in two and the decision gets lost between them.

To add findings while a review is open, call \`mcp__diffprism__annotate\`.

## Choosing a scope

| \`diff_ref\` | Shows | Use when |
|---|---|---|
| \`"working-copy"\` *(default)* | Everything uncommitted; staged and unstaged as separate groups | Almost always — "review my changes" |
| \`"staged"\` | Only what the next commit contains | Reviewing exactly what is about to be committed |
| \`"unstaged"\` | Only edits not yet staged | Rarely — reviewing work in progress beside a staged commit |
| \`"HEAD~3..HEAD"\`, \`"main..feature"\` | A range of commits | Reviewing work that is already committed |

## Commit gate

If the repo has the DiffPrism pre-commit gate installed (\`diffprism hook install\`), a \`git commit\` of a large enough change opens a review and **waits for a human**. It reviews **staged** changes only — unlike every other entry point — because a commit contains exactly the index; unstaged edits aren't part of what is being approved.

- Run \`git commit\` with a shell timeout long enough for someone to read the change — up to 600000 ms — not the short default.
- If the commit is interrupted, or reports no decision, the review is still open. Once the reviewer decides, run the **same** \`git commit\` again: their decision is picked up immediately. Don't change the staged files first — that makes it a new question.
- If it's blocked with changes requested, the reviewer's summary and comments are printed. Address them, stage, and commit again.
- If it's blocked because the reviewer asked something, each question is printed with the command that answers it — \`diffprism reply --session <id> <annotation-id> "<your answer>"\`. Run it for each, then run the same \`git commit\` again — the review is still open.

## Workflow 3: PR Review

Pull requests are opened by the user — \`diffprism review <PR URL>\` or "Review PR" in the dashboard — not by \`open_review\`. You then work inside that review:

1. \`mcp__diffprism__get_pr_context\` — title, author, branches, file list, briefing summary, and whether a local clone is connected.
2. \`mcp__diffprism__get_file_diff\` — one file's hunks and triage category (critical/notable/mechanical).
3. \`mcp__diffprism__get_file_context\` — the full file from the local clone, so you see surrounding code rather than just the hunks.
4. \`mcp__diffprism__get_user_focus\` — what the user is looking at right now. Offer context about it.
5. \`mcp__diffprism__get_review_comments\` — what has already been said, before you add to it.
6. \`mcp__diffprism__annotate\` — post findings inline on the diff.

The reviewer can also ask you questions on lines of the PR. Hold that conversation in the dashboard, not the terminal:

1. \`mcp__diffprism__wait_for_comments\` — blocks until the reviewer writes something you haven't answered, then returns those threads.
2. \`mcp__diffprism__reply\` — answer each thread, passing its \`annotation_id\`.
3. Wait again. On \`timed_out\`, nothing new was said — keep waiting until the user tells you to stop.

When no agent has read a question, the dashboard tells the reviewer so, and to ask you to answer their DiffPrism comments on a session id. When they do, run this loop with that \`session_id\`.

A PR review and a working-copy review can be open for the same clone at once. If a tool reports more than one session, pass the \`session_id\` of the one you mean.

## Tool Reference

### Opening and deciding
| Tool | Purpose |
|------|---------|
| \`open_review\` | Open a review of local changes and wait for the decision. |
| \`get_review_result\` | Check the decision on a review already open (after \`wait: false\` or a timeout). |
| \`update_review_context\` | Update reasoning, title, or description on an open review. |

### Headless analysis
| Tool | Purpose |
|------|---------|
| \`analyze_diff\` | Analysis JSON (patterns, complexity, test gaps) without opening a browser. |
| \`get_diff\` | Structured diff JSON (file-level and hunk-level changes). |

### Working in an open review
| Tool | Purpose |
|------|---------|
| \`annotate\` | Post one or more findings. \`warning\` flags the session for attention. |
| \`get_review_comments\` | Every thread on the review; \`awaiting_reply\` narrows to threads waiting for an answer. |
| \`reply\` | Reply to a thread — answer the reviewer's question or follow up on a finding. |
| \`wait_for_comments\` | Block until the reviewer writes something you haven't answered. |
| \`get_review_state\` | Session status, attention and new-changes flags, and annotations. |
| \`get_user_focus\` | What the user is currently looking at. |
| \`get_pr_context\` | PR overview: metadata, briefing, file list, local clone status. |
| \`get_file_diff\` | Hunks for one file, with triage category. |
| \`get_file_context\` | Full file content from the local clone. |

## Rules

- **Self-review is proactive** — run \`analyze_diff\` after significant changes without being asked.
- **Human review requires explicit request** — only call \`open_review\` when the user asks (\`/review\`, "review my changes", or as part of a defined workflow like PR creation).
- **Don't open a second review to check on the first** — use \`get_review_result\`.
- **Don't ask the user about a review that's open** — wait for the decision; it is their answer.
- **Annotate generously** — the more context you provide, the faster the reviewer can decide.
- **PR review is conversational** — when a PR is open, use the PR tools to answer questions and post findings without being asked to use specific tools.
`;
