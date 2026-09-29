---
title: Findings nothing is listening for get a way to an agent — including one you start from the review
date: 2026-09-28
kind: feature
pr: 285
---

## What changed

A finding you send back on a local review reaches an agent only while one is waiting on the review. That's the `git commit` held at the gate, `diffprism review`, or an agent's `open_review`. Those waits end: the gate gives up after ten minutes. Until now, a finding sent after that read "Sent — no agent is waiting on this review yet. It gets this the next time one does," and nothing on the page could make that happen.

Now the status line under the diff says what stopped waiting and what to do. For example: "2 are waiting for an agent, but the git commit that was waiting on this review stopped. Start an agent here to fix them, or ask yours to run git commit again." Next to it is **Start an agent to fix these**.

The button starts your Review agent (Claude Code or Cursor, with the model from the settings) in the repository:
- It reads each finding, makes the smallest fix, and replies on the thread marked Fixed. If a finding isn't a problem, it replies and says why.
- It never commits. It has no shell at all, only the tools to read, edit and write files and to reply. On a review of staged changes, DiffPrism stages exactly the files it changed after each turn, so the fixes show up in the review.
- It keeps waiting on the review, so findings you send later go to it too, and it stops when you decide.

While it works, the status line reads "Claude Code is fixing 2 findings…". If it stops, the line says why and offers to start it again. The notices on dojo cards and inline threads now point to that button, and on a commit-gate review the prompt to paste is "Run git commit again and answer the DiffPrism review".

## Why

Dogfooding the dojo, the commit gate timed out twice while the reviewer read. They sent two findings back, saw "It gets this the next time one does", and had to tell the agent in its chat that the fixes were waiting. That was the only way for the agent to find out.

## Decisions

**No shell for the fixer, and DiffPrism stages.** An agent with `git` could commit, and Cursor's permissions can allow or deny a whole command but not `git add` without `git commit`. So the fixer gets file tools only, and staging happens outside the agent. Its writes are limited to the repository, and `.git` is off limits, where a hook would run on your next commit. It could still write a script that runs later, like any change. That's why its edits land in the review for you to judge, and the dashboard says so rather than calling it harmless.

**Your unstaged edits stay unstaged.** The first version staged each file the fixer touched whole, which would have swept in lines you'd deliberately left out of the commit (the dojo caught it). Now:
- A file that was clean gets staged whole.
- A file you had unstaged edits in gets only the fixer's change: a three-way merge of what's staged, the file before the turn, and after.
- If the fixer's change overlaps yours, it stops and says so rather than guess.

**One agent at a time, and only for the dashboard.** The server won't start a fixer while something is waiting on the review (that caller gets the findings itself), or while another fixer is running or still starting. It only starts one for the dashboard or a local process. The API answers any origin, so without that check any web page could have started an agent that edits your files.

**Only where a fix would show.** A review of staged, unstaged or working-copy changes shows a fix as soon as it's made (or staged). A review of a commit range doesn't, so there's no button there. The line says what to ask your agent instead. PR reviews already have their own agent, which answers questions.

**It's the same listener.** The fixer is the loop the PR agent already uses: it waits on the review, and runs one turn when threads arrive. The only differences are its instructions, its edit permission and the staging wrapper.

## What we learned

The old line was accurate and still left the reviewer stuck. A status that's true but offers no next step reads as a dead end, so each "nobody is listening" message now names the step that gets the finding to an agent.
