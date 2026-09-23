---
title: A PR review starts its own agent to answer your comments
date: 2026-09-22
kind: feature
pr: 218
---

## What changed

Run `diffprism review` on a pull request and you can start asking questions straight away. Comment on a line in the dashboard, and Claude Code answers in the thread, reading your local clone. Ask a follow-up and it remembers what it said before. The command stays running while you review, and stops when you submit the review or press Ctrl-C.

Until now, a question on a PR sat unanswered until you opened a Claude Code session and pasted `Answer my DiffPrism comments on session-…` into it. That is two windows and a copy-paste between having a question and getting an answer.

## Why

The point of commenting on a line is to ask about it while you are looking at it. Having to set up a conversation first broke that, and it broke again whenever the agent you had started stopped listening.

## Decisions

**DiffPrism waits, Claude doesn't.** The command watches the review for new comments itself, and runs Claude only when there is something to answer: one headless turn that replies to the waiting threads and then exits. Keeping an agent alive to wait would have meant it spending turns on "nothing yet", and it would have had to remember to keep listening, which is exactly what had failed before. Each turn resumes the same Claude Code conversation, so the agent keeps its context from one question to the next.

**The threads go in the prompt.** Each turn hands Claude the threads themselves: the file, the line, and everything said so far. It doesn't have to go and find them, so it starts from the code the question is about.

**It can read, not write.** The agent may read the PR, your clone and the review, and reply. That's all. Editing files and running commands are denied outright. Allowing only the read tools wasn't enough on its own, because a permissive default in your own Claude Code settings would have let other tools through, so the command also sets the permission mode itself.

**It talks to the DiffPrism that opened the review.** The agent's DiffPrism tools come from the same build as the command, not from whatever a project's `.mcp.json` points at.

**If it gets stuck, it stops.** If Claude finishes a turn without replying to a thread, the command stops and shows what Claude said, instead of handing it the same question again and again.

**The conversation is yours to keep.** Claude Code saves each conversation so the next answer can pick it up, which means one saved session per review. When the review ends, the command prints the `claude --resume` command that continues it in your terminal, so the saved session is something you can use rather than an unexplained entry in your history. Claude Code removes old sessions on its own schedule.

`--no-agent` opens the review the old way. Without Claude Code installed, the command says so and prints the prompt to paste. A PR opened from the dashboard's Review PR form doesn't start an agent yet, because there's no terminal to run one in.
