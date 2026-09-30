---
title: Post a dojo finding to the pull request, and choose the skills the dojo reviews by
date: 2026-09-29
kind: feature
---

## What changed

**Post a finding to GitHub (#289).** On a pull request review, each finding in the review dojo has **Post to GitHub**. It puts the finding on its line of the PR as a comment: its severity and title in bold, what's wrong, and a line saying it was raised in a DiffPrism review dojo and which agents agreed. The card then links to the comment, and it can't be posted twice. If GitHub won't take it (a line outside the PR's diff, say), the card says why.

**Skills for the dojo (#290).** A new **Settings** button at the bottom of the sessions sidebar opens a Settings modal. Alongside the review agent, it lists the skills the dojo can review by:
- **Where they come from:** skills are folders with a `SKILL.md`, the format Claude Code uses. Yours live in `~/.claude/skills`; a repository's in its `.claude/skills` apply when you review that repository locally.
- **How they're applied:** tick the ones you want, and every agent in the next dojo gets each skill's instructions in its own. That includes Cursor, which has never heard of them.
- **What you see:** the dojo panel says which skills it reviewed by.

The review agent settings moved into the same modal. In a narrow sidebar their panel used to be cut off (#259); a modal has room.

## Why

Both came from using the dojo on real pull requests. A good finding meant retyping it into GitHub by hand. And every team has its own things a review should check, which the dojo's generic instructions don't know about.

## Decisions

**Posting is the reviewer's call, one finding at a time.** The dojo never posts anything to GitHub on its own. An AI's finding goes on a PR under your name only when you choose it, and the comment says where it came from.

**Skills go in the instructions, not the agent.** Claude Code could load skills itself, but Cursor can't, and a dojo is meant to be a fair comparison. Putting each skill's text into every agent's instructions works the same for every agent, and needs nothing installed.

**A pull request's own skills are never read.** Its checkout is the PR author's code (#257). A skill there could tell the reviewers to find nothing. Only your own skills apply to a PR.

**A repository's skill belongs to that repository.** Choosing `house-style` while reviewing one repo applies it only there. The dojo's review caught the first version applying it in any repo with a folder of that name, which would have run another repo's instructions.

**A chosen skill that's gone stops the dojo.** If a skill of yours was deleted, the dojo won't start, and it says which skill. Quietly reviewing without a skill you chose would mislead you. A repository's skill just doesn't apply where that repository doesn't have it.
