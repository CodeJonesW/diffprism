---
title: Bound what live watchers cost
date: 2026-09-17
kind: fix
pr: 171
---

## What changed

Open review sessions cost much less when nobody is looking at them. A session you're viewing still checks for new changes every 2 seconds. A session nobody is viewing backs off: 30 seconds, then 1, 2 and 4 minutes, up to a 5-minute ceiling. It drops back to 30 seconds when something changes. Ten quiet, unviewed sessions go from 300 `git diff` runs a minute to about 2.

Sessions that nobody has viewed, waited on or changed for 24 hours now expire.

## Why

Every session with a diff ran `git diff` every 2 seconds, whether or not anyone was looking. Some sessions never went away. One opened from the dashboard was only removed by an explicit close. One in review matched no expiry rule at all. So the cost grew with every session and never came back down.

## Decisions

Watchers can't just stop when nobody is viewing. A session that changes while unwatched still has to show its "new changes" signal. So the interval depends on who's looking.

Nothing that needs to be instant depends on polling. A commit hook firing or an agent opening a review updates the session directly. And a backed-off watcher is woken the moment someone opens the session, so they never see a diff that's minutes old. When `git diff` fails, the watcher backs off like a quiet repo instead of retrying at full speed.

Age alone doesn't expire a session someone opened from the dashboard. An hour without a verdict isn't abandonment.

## What we learned

There were three ways a dashboard could start viewing a session. Each copied the same steps by hand, and they had drifted: only one of them started the watcher. They're now one function, which is also where the wake-up happens.
