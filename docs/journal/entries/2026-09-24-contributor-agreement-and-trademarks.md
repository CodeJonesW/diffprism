---
title: An Apache 2.0 license, a contributor agreement, and a trademark policy
date: 2026-09-24
kind: infra
---

## What changed

DiffPrism is now licensed under the Apache License 2.0. Until now it had no license at all, which left users of the npm package without legal permission to use or modify it.

DiffPrism now has a CONTRIBUTING.md that walks through setup, the checks a pull request has to pass, and the PR title prefixes that drive releases. Contributors sign a Contributor License Agreement with one comment on their first pull request; a bot asks for it and records the signature on a separate `cla-signatures` branch, so `main` stays clean.

A trademark policy sets out how the DiffPrism name can be used: say your tool is "compatible with DiffPrism" or "a fork of DiffPrism", but give a modified fork its own name.

## Why

DiffPrism has been built by one person so far. Before other people start sending code, it's worth settling how their contributions can be used, because that question is much harder to answer after the fact than before the first outside PR is merged.

## Decisions

**Apache 2.0 over MIT or AGPL.** Apache is as permissive as MIT but adds an explicit patent grant and a NOTICE file, and it matches the Apache-style CLA. AGPL would force anyone hosting a modified DiffPrism to publish their changes, but DiffPrism runs locally, and plenty of companies won't touch AGPL code.

**Contributors keep their copyright.** The CLA is a license, not an assignment, modeled on the Apache individual CLA. It lets the project relicense contributions later, including for paid features, without tracking down every past contributor.

**The name is separate from the code.** Code licenses cover code. Keeping the name under a trademark policy means anyone can build on the code, and users can still tell the official release from a fork.
