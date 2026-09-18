---
title: Share feedback and report bugs from the installed tool
date: 2026-09-17
kind: feature
pr: 172
---

## What changed

A new command opens a prefilled GitHub issue in your browser:

```bash
diffprism feedback                 # share feedback
diffprism feedback --bug           # report a bug, with the last error
diffprism feedback -m "…" --print  # prefill text; print the URL (SSH / CI)
```

The dashboard has a Send feedback link at the bottom of the sidebar.

A report includes the DiffPrism version, whether it's a dev or release build, the OS and the Node version. A bug report also includes the last error and the command that produced it. When the CLI review, the commit gate or the MCP server hits an unexpected failure, it records the error and ends its message with how to report it.

## Why

We wanted a way for people using the installed tool to tell us what works and what breaks, including errors.

## Decisions

DiffPrism has no backend. Quietly collecting data from people's machines is also a consent decision, and not one to make by default. So feedback is a GitHub issue the user reads and edits before submitting. Nothing is sent automatically. Anonymous usage data would need a backend and an opt-in design, and this doesn't rule that out.

Reports never include the checkout path. In an error, the home directory is replaced with `~`. Long errors are shortened to fit GitHub's URL limit.

Timeouts and rejected reviews are not recorded as errors, because they aren't bugs. Recording an error may fail silently. A copy for a bug report must never replace the error the user actually needs to see.

## What we learned

The dashboard fetches the feedback link up front and renders it as a plain link. Opening a window after an `await` doesn't count as a user action, and browsers block it as a popup.
