---
title: A round of fixes shows what changed since you last looked
date: 2026-09-27
kind: feature
---

## What changed

When a review's diff changes after you've looked at it (an agent stages fixes for the findings you sent, or commits again), DiffPrism now says what changed:

- **A banner** across the review: "Changed since you last looked: 2 files +14 −6", with each file one click away.
- **The file list** marks those files, "changed since you last looked", with that round's own +/− counts.
- **In the diff,** each new hunk is labelled "New since you last looked". **Show only these changes** hides the rest, so a round of fixes is a few hunks, not the whole change again.
- **A Fixed finding's card** in the Review dojo says which lines of its file changed: "Changed since you last looked: cache.ts line 22". One click takes you there, showing only what's new. If nothing in that file changed, the card says so, which makes a fix claimed but not visible easy to spot.

**Mark as seen** clears it, and the next round counts from there. It holds across page reloads, and across several rounds until you mark it.

## Why

Sending findings back worked, and the agent could say it fixed each one, but seeing the fixes still meant hunting. The review came back as the whole diff again, and nothing said which few lines had moved. Dogfooding it, three findings went back and were fixed, and the reviewer couldn't tell from the screen that anything had happened.

## Decisions

**Compare hunks by what they change, not where.** A fix near the top of a file shifts the line numbers of every hunk below it. Matched by line numbers, those hunks would all look new. Matched by their content, only the fix does.

**The last look is what was on your screen.** The server remembers the diff it last sent to someone viewing the review. When the diff changes after that, that version becomes the baseline, and stays one through later rounds until you mark them seen. A comparison against another ref that you ask for yourself starts over, because that's a different question, not a new round of the same one.

**Filter, don't re-diff.** "Show only these changes" hides the hunks you've seen; it doesn't compute a diff between two versions of the file. That keeps it exact about what's in the review, and cheap.
