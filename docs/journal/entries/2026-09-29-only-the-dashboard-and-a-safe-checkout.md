---
title: Only the dashboard can drive DiffPrism, and a pull request's checkout can't reach you
date: 2026-09-29
kind: fix
---

## What changed

**Only the dashboard can use the server (#284).** DiffPrism's server listens on `localhost`. It answered every request with `Access-Control-Allow-Origin: *` and checked nothing. So any web page open in your browser could:
- read every review, its diffs and its threads;
- approve a commit held at the commit gate;
- post a GitHub review as you;
- start agents.

Now:
- A request from a web page must come from the dashboard, for reads as well as writes, since some reads have effects.
- Browser extensions may read. The DiffPrism extension's popup checks the server and finds a PR's review.
- Local tools work as before: the CLI, the commit gate, agents' MCP servers. Missing `Origin` alone doesn't prove a request is local, though: browsers leave it off an `<img>` load or a same-origin GET (the dojo caught that). So a request counts as local only if it also carries no browser Fetch Metadata and names this machine as its host, which turns away a page that points its own domain at 127.0.0.1.
- CORS names the one page it answers, never `*`, and the WebSocket turns other pages away too.

**A pull request's checkout can't act as you (#257).** Reviewing a pull request means reading someone else's code:
- **Agents no longer start inside the checkout.** Claude Code loads `CLAUDE.md`, settings and hooks from the folder it starts in. With the agent running in the PR's checkout, a PR could ship a hook that ran as you, or instructions it followed. Every agent that only reads now runs in a folder of its own and gets the code with `--add-dir`, which loads none of that. Cursor already worked this way.
- **Your git config stays out of the checkout.** Fetching the PR sends your GitHub token, and your own git config could redirect that fetch (a URL rewrite, a proxy, a credential helper). It could also run a smudge filter such as Git LFS, which fetches again without the token. Now every git command for a checkout runs without your global or system config.

**And the checkout reads what the PR changed.**
- **The diff's old side is the merge base.** GitHub's diff runs from where the PR branched off. DiffPrism read the old side at the base branch's tip, which moves on as others merge.
- **The fetched commits are pinned.** They sit in refs of the PR's own, so gc can't prune them.
- **Broken folders are rebuilt.** A repository or worktree folder left by a failed attempt is made again instead of trusted. A worktree is cleaned back to the PR's head each time.
- **One checkout per repo, however it's typed.** Paths use GitHub's own spelling of the owner and repo, so `Acme/Widget` and `acme/widget` share one checkout, and a name that isn't plain is refused.

## Why

The review dojo raised #257 while reviewing the PR-checkout change itself, and it raised #284 while reviewing the fix-it agent, whose endpoint could edit your files. Both were real holes in a tool that runs agents on untrusted code.

## Decisions

**Extensions may read, and only read.** Shutting every non-dashboard origin out would have broken the extension's popup. Letting any extension read is no worse than what installed extensions can already do, and nothing but the dashboard can change anything.

**Two findings wait for their own change (#287).**
- Reopening a PR moves its worktree to the new head, even if an agent is reading it at that moment.
- Old checkouts are never removed.

The fix for the first, one checkout per commit, would leave a running PR agent answering from the old head, so both belong in one change about how long a checkout lives.
