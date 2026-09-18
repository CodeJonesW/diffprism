---
title: A decision that doesn't arrive says so
date: 2026-09-18
kind: fix
pr: 207
---

## What changed

When you approve, request changes on, or dismiss a local review, the dashboard now waits for the DiffPrism server to confirm it recorded your decision. While it waits, the buttons are held and the one you clicked says "Sending…". If the server can't be reached, or no longer has the review, the review stays on screen and the action bar says what went wrong. Your summary is kept, and choosing again resends it.

Before, the review cleared as soon as you clicked, whether or not the decision arrived.

## Why

An agent or a commit is usually waiting on your decision. The pre-commit gate holds `git commit` until you decide. If your decision never reaches the server, the thing waiting on it stays stuck. You believe you already answered, and nothing on screen says otherwise. While dogfooding the commit gate, a reviewer clicked, nothing happened, and the commit stayed blocked with no explanation.

The decision was sent as a WebSocket message, which gets no reply. If the connection had dropped, the message went nowhere. If the server didn't know which review the tab was showing, it dropped the message without a word.

## Decisions

Decisions now go over the HTTP endpoint that already existed for them. It answers: recorded, the review doesn't exist, or the request couldn't be read. We removed the WebSocket message outright rather than keep two ways to send a decision, one of which could fail silently. That's safe because a dashboard tab that reconnects to a different server reloads, so an old tab can't keep sending the old message.

The failure shows in the action bar at the bottom of the review, whichever button you used. Approve & Commit in the file list's menu sends through the same path and reports there too.
