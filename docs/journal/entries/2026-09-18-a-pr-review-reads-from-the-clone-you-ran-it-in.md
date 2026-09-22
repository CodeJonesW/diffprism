---
title: A PR review reads from the clone you ran it in
date: 2026-09-18
kind: fix
pr: 210
---

## What changed

Run `diffprism review <PR URL>` from inside your clone of the repo, and the review now reads from that clone. Your agent can open whole files, not just the lines in the diff. It works from any folder in the clone.

## Why

Every PR review said "No local clone detected — file context unavailable", even when run from inside the clone. DiffPrism looked for a clone in the folder its background server happened to start in, not the one you ran the command from. The server starts once, wherever the first review ran, and then serves every review after that, so its folder is rarely the one you're in. The README worked around this by telling you to start the server from inside your clone.

## Decisions

The command now sends the folder it ran in, and the server looks for a clone there. It checks the folder's GitHub remotes against the PR's repo, and records the clone's top folder, even if you ran the command from a subfolder.

The dashboard's Review PR form has no folder of its own, so a PR opened there still uses whatever clone the server was started in. An agent working in any clone of the repo already finds that review through its remotes.
