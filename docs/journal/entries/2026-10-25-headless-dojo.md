---
title: Run the review dojo with nobody watching
date: 2026-10-25
kind: feature
---

## What changed

An agent can run the review dojo on its own work and get the findings back, with no browser open. From a shell:

```bash
diffprism dojo --staged --agents claude,cursor --json
```

It opens a review of the diff that no tab opens for, seats the agents, waits while they review and vote on each other's findings, and prints the result. With `--json` that's `{ status, passed, blocking, findings, agents }` on stdout. The exit code says how it went: 0 when nothing at `--fail-on` (default `major`) or above got through, 1 when something did, 2 when the dojo failed, was stopped, or ran past `--timeout`.

An agent in Claude Code does the same with the `run_dojo` tool, and `get_dojo_result` when the dojo is still going after the tool's wait. The review stays open the whole time, so you can still read every finding as a thread in the dashboard whenever you want to.

## Why

The dojo was the most thorough review DiffPrism had, and it only ran when someone pressed its button in the dashboard. Its findings only reached the agent that wrote the code after a person picked them out and sent them (#238). So the loop we actually wanted, where an agent does the work, has it reviewed, fixes what the review found and checks again, always needed a person in the middle clicking. This is the first step of #262: the agent closes the loop itself.

## Decisions

**The agent that did the work fixes it, not the dojo.** The dojo agents still only read. `run_dojo` hands the findings back to the caller, which fixes what it agrees with and runs the dojo again on the new diff. That's the rule #238 set, and it keeps one agent responsible for the change.

**What fails a dojo.** A finding blocks when it's at `--fail-on` or above, as the agent that raised it rated it, and no other agent disputed it. A dojo with one agent can still fail: its findings have nobody to agree with them, and ignoring them would make a one-agent dojo always pass.

**Polled, like a decision.** The server already answers "is it decided yet" by being asked every two seconds (`waitForDecision`). The dojo works the same way, through a new `GET /api/reviews/:id/dojo`, rather than a long-held request the server would need new machinery for.

**Stopped when the wait runs out on the command line, kept going for an agent.** `diffprism dojo` stops the dojo at `--timeout`, so nothing keeps spending tokens after the command has given up. `run_dojo`'s wait is capped at ten minutes like every other blocking tool, and a dojo can take longer. There, the dojo keeps running, and the agent picks the result up with `get_dojo_result`.

## What we learned

Most of this already existed. The dojo's runner never needed a dashboard; only the button to start it and the panel to read it did. What was missing was a way in and a way out that didn't go through a browser.
