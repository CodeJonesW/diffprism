---
title: A finding you send back shows as fixed, and you can dismiss it
date: 2026-09-27
kind: feature
---

## What changed

When you send a dojo finding to the agent that made a change, you can now see it come back fixed. The agent makes the fix, then answers with `diffprism reply --fixed "<what it changed>"`, or `fixed: true` on the MCP `reply` tool. The finding's card in the Review dojo then shows **Fixed by the agent**, with the agent's note on what it changed. Its reply is marked **Fixed** in the thread, too.

Sending findings is now one action, **Send to the agent to fix**, which replaces **Ask the agent** and **Add to request for changes**. Each finding goes to its own thread, so each can be followed on its card.

Each finding card also has a **Dismiss** button. A dismissed finding dims, drops out of the send actions, and its thread is dismissed with it. Dismiss the ones that are fixed, or the ones you've decided aren't worth acting on.

## Why

Sending findings back went quiet after "Sent to the agent — it has it". You couldn't tell whether the agent was on it, had fixed it, or had decided against it, and there was no way to clear a finding you were done with.

## Decisions

**Fix in place, don't commit.** Under the commit gate, the agent can't commit a fix: the commit is exactly what your review is holding. So the agent fixes the code and stages it. The review shows the staged diff and refreshes as it changes. The agent says the finding is fixed, and the fix goes into the one commit that lands when you approve. We considered having the agent commit each fix on its own, but every one of those commits would go through the same gate. Fixes would also land before anyone had looked at them, which is the thing the gate is there to prevent.

**One way to send, so every finding can be followed.** The dojo used to offer two: ask about findings on their threads, or add them to your request for changes. They looked like equals, but only the first could be followed. Adding to a request for changes only drafted inline comments in your browser until you pressed Request Changes, and a request for changes ends the round and hands over every comment at once, so nothing could show a finding as picked up or fixed. We found this by using it: findings "requested" from the dojo sat unsent, with no way to tell. So findings now only go to their threads, and Request Changes is for your own words.

**"Fixed" is the agent's word, and says so.** It's a field on the agent's reply, which only an agent can set, and the card labels it "Fixed by the agent". It's a report, not a check. The diff is where you confirm it. Asking about a fixed finding again reopens it.

## What we learned

The gate's own advice was "don't change the staged files" while it waits, which is right for a plain retry. Once the reviewer can ask for a fix, the advice has to say the opposite for that case: stage the fix, don't commit. Those instructions now go out with the question itself.
