---
title: Choose the agent that answers, and its model
date: 2026-09-25
kind: feature
---

## What changed

The agent that answers your comments on a pull request review no longer has to be Claude Code on its default model. Choose Cursor, or a particular model for either, in any of three places:

- **The dashboard:** **Review agent** at the bottom of the sessions list.
- **The command line:** `diffprism config set agent cursor`, `diffprism config set cursor.model gpt-5`.
- **One review:** `diffprism review <PR URL> --agent cursor --model gpt-5`.

The dashboard and `diffprism config` change the same saved setting. A flag on `diffprism review` applies to that review only.

## Why

Most people settle on one agent and one model and stick with them, then switch now and then for a particular review. Until now the answer was always Claude Code, on whatever model it defaulted to.

## Decisions

**Each agent keeps its own model.** A model name means nothing to the other agent: "opus" isn't a Cursor model, and "gpt-5" isn't a Claude one. So instead of one "model" setting, each agent remembers its own. Switch to Cursor for a week and back, and your Claude model is still there.

**A setting that can't be read says so.** If the saved agent is one DiffPrism doesn't know, say from a hand-edited file, the review still opens. The agent doesn't start, and the command says why, naming the file. Quietly falling back to Claude would have left you wondering why you didn't get the agent you chose.

**The agents plug into one listener.** DiffPrism does the waiting for every agent. Each agent only has to say how to start a conversation and how to run one turn of it. Adding a third agent is a matter of describing those two things.

**Cursor works from a folder of its own.** Cursor only picks up extra tools and permissions from settings files in the folder it works in, so DiffPrism can't hand it the review tools the way it does Claude Code. Rather than write those files into your repository, Cursor works from a folder DiffPrism owns and is given read access to your clone.

**Read-only comes from permissions, not "ask" mode.** Cursor's read-only ask mode looked like the obvious fit, and it's what we built first. Then we tried it: ask mode treats posting a reply as a write and refuses it, so Cursor wrote its answer into its own output, where nobody would ever see it, and DiffPrism stopped the agent for not replying. Instead, a permissions file lets Cursor read and use DiffPrism's tools, and refuses every file write and shell command. We checked that it can't write into your clone either.

**The commit gate is unchanged.** A review opened by the pre-commit hook starts no agent. The agent that made the commit is waiting on it and answers your questions itself.
