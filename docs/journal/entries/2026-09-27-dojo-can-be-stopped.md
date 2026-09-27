---
title: A dojo you can stop, that stops on its own, and says who it's waiting for
date: 2026-09-27
kind: feature
---

## What changed

- **Stop.** A running review dojo has a **Stop** button. It ends at once: every agent still working is stopped, and the pane says so and offers to run it again.
- **It stops on its own when the review is done.** Decide on a review, or close it, and a dojo still running on it stops, instead of running on for a review nobody is looking at.
- **A quiet agent drops out.** An agent that goes five minutes without doing anything (no tool call, no thinking, no output) is stopped and drops out with that reason. The others carry on. A long review that keeps working is never cut off; the limit is on silence, not length.
- **"Waiting for Cursor".** When one agent's review is in and another's isn't, the finished one says who it's waiting for, with an hourglass instead of a spinner. It used to keep saying "Reviewing", which looked stuck.

## Why

A dojo on a big change can take a while, and there was no way to end one. A hung agent kept it "running" for good, and a second dojo couldn't start while one ran. The only way out was restarting the server. Approving a review mid-dojo left the agents working on a change that was already decided. And the dashboard couldn't tell a slow agent from a stuck one: an agent that had finished its review kept saying it was reviewing while it waited for the other.

## Decisions

**A stopped dojo keeps nothing.** One agent's findings are only worth reading once the others have voted on them. Half a dojo would show findings with no agreement behind them, looking like a finished result. Stopped means stopped; run it again for a full one.

**Silence, not a deadline.** A flat time limit would cut off an agent doing a thorough review of a large change. Agents stream what they do as they go, so a long gap with nothing is the real sign of a hang.

**Deciding ends the dojo.** Once the round is decided, nobody will act on findings that arrive after. Letting it finish would spend the agents' time on a review that's over.
