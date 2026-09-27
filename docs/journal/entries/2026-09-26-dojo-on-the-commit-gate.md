---
title: The dojo reviews your commits, and its findings go back to the agent that wrote them
date: 2026-09-26
kind: feature
---

## What changed

The review dojo now runs on local reviews, not only pull requests. When the commit gate stops an agent's `git commit`, you can open the Dojo pane on that review and have Claude Code and Cursor review the staged change and vote on each other's findings, the same as on a PR.

Then you can send the findings back to the agent that made the change. Each finding has a checkbox, and the agreed ones are ticked to start with. **Ask the agent** puts a question on each ticked finding's thread. The blocked commit ends, the agent gets the finding and your question, and it fixes the code or replies. **Add to request for changes** turns them into inline comments on your Request Changes. Each finding card says where it stands: sent, picked up, answered, or in your request for changes.

When the gate hands the agent a question on someone else's thread, it now prints the thread's opening message as well as your latest reply. "Please fix this" arrives with the finding it refers to.

## Why

The commit gate is where DiffPrism reviews an agent's work before it lands, and the dojo is the most thorough review it offers. They didn't meet. The dojo refused local reviews, and nothing carried a dojo finding back to the agent waiting on `git commit`, which is exactly the one that can fix it.

## Decisions

**Two ways back, both ones the agent already hears.** A blocked commit reaches the agent through the questions it prints and the verdict's comments. We used those rather than a new channel. Asking keeps the review open for another round. Request for changes ends it. The dojo agents stay read-only reviewers and never touch the code.

**A finding's status is read off its thread.** Whether a finding was sent, picked up or answered comes from who spoke last on its thread and when an agent last read the review. Nothing is recorded beside that, so it can't drift from what actually happened.

**Agents judge the staged version.** A commit is the index, not the files on disk. `get_file_context` now reads the version of each file that the review's diff shows: the index for the commit gate, the working tree for uncommitted changes, and the head of a range. It used to read HEAD, which is the code from before the change. The dojo's instructions also tell its agents that files on disk may hold edits the commit leaves out.

## What we learned

A local review is reopened every time the agent commits again. The dashboard reset its state when that happened, and the server re-sent the threads but not the dojo. So the loop this change exists for, where the agent fixes things and commits again, blanked the pane that had sent the findings. Test the loop, not just its first step.
