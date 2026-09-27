---
title: Every review says whether it's a pull request or a local change, and who gets your decision
date: 2026-09-27
kind: feature
---

## What changed

A review now says what kind it is and where your decision goes:

- **The header** has a row for it: a **Pull request #239** badge and "Your decision goes to GitHub, as a review on CodeJonesW/diffprism#239". A local change gets **Local · staged · commit gate** and "Your decision and summary go back to the git commit waiting on this review, not to GitHub."
- **The session list** labels each review the same way, so a PR review and the commit gate's review of the same branch no longer look alike.
- **The local decision bar** repeats where the decision goes, and its summary box now reads "Summary for the agent, sent back with your decision — not posted to GitHub".
- **The ref picker** shows what the review is of. The commit gate's reads "staged", not "working copy".
- **The dojo on a PR review** says why it has no "Send to the agent" button: its findings stay in DiffPrism, and sending findings to an agent is for local reviews.

## Why

While dogfooding the dojo, we ran it on a PR review and went looking for the button that sends findings back to the agent. It was on the commit gate's review of the same branch, which looked almost identical: same branch, same file count, same status. The only clue was a small icon. Separately, typing a summary into a local review's decision bar, it wasn't clear whether it would be posted on GitHub or go to the agent.

## Decisions

**One place decides the wording.** The header, session list, decision bar and ref picker all get their label from one function. It reads the session's pull request, diff ref, and what's waiting on it, so they can't drift apart.

**Say where it came from only when we know.** A local review names its origin (commit gate, `diffprism review`, `open_review`) once something has waited on it, and "opened here" for one opened from the dashboard. Otherwise it's just "Local · staged".

We didn't link a PR review to a local review of the same branch. That would help, but it's more than labelling.
