---
title: An agent keeps waiting when its wait runs out, and Review PR works with a review open
date: 2026-09-28
kind: fix
pr: 286
---

## What changed

**The agent keeps listening (#282).** The commit gate waits ten minutes for your decision. When that ran out, it told the agent: "once the reviewer decides, run git commit again". The agent can't know when you decide, so it did the only sensible thing and stopped, then asked you in the terminal. From then on nothing was listening, and whatever you sent from the review reached no one. With a review dojo running, a review easily outlasts one wait.

Now the gate says to run `git commit` again straight away to keep waiting, as it already did after you ask a question. The agent is back within seconds and gets your decision, or your findings, as soon as there is one. `diffprism review` said nothing at all when its wait ran out; it now gives the same advice.

The issue asked us to double check whether commenting ends the dojo. It doesn't: a comment while a commit waits, and the commit coming back, leave the dojo running. A test now holds that. What ended the listening was the timeout advice.

**Review PR and Open project work with a review open (#281).** Both buttons showed their form only when no review was open. With one open, clicking them did nothing you could see. Now the form shows in place of the review. The review stays open underneath, and nothing you'd started in it is lost. No session is highlighted while a form shows, and clicking any session, the one you were on included, takes you back. Opening a project now takes you to its review, as Review PR already did, instead of back to the review you were on.

## Why

Both came from dogfooding. The first time, the gate timed out twice while the dojo reviewed a change, and findings sent afterwards sat unheard. The second time, the sidebar's buttons seemed broken whenever a review was open.

## What we learned

Advice that depends on something the reader can't see ("once the reviewer decides") isn't advice an agent can follow. Say the next step it can take now.
