---
title: A pull request review opens its own tab
date: 2026-09-24
kind: fix
---

## What changed

Run `diffprism review` on a pull request with no DiffPrism tab open, and a tab now opens on the review. Before, the review started where nobody could see it: the command said "Review open in browser", and you had to go and open the dashboard yourself.

## Why

DiffPrism opens a tab when a review arrives and nobody is watching. It waits a few seconds after a restart first, so a tab that was already open has time to reconnect instead of getting a twin. But only reviews of local changes asked for that tab. A pull request review went through a different route on the server, and that route never asked.

## Decisions

The pull request route now asks the same question in the same way, so the rules match. A tab opens only when no dashboard is connected, and not during the few seconds after a restart. If you open a PR from the dashboard's own Review PR form, that dashboard is connected, so nothing extra opens.
