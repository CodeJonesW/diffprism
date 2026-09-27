---
title: An agent can only read files inside the repo under review
date: 2026-09-26
kind: fix
---

## What changed

`get_file_context`, the tool agents use to read whole files during a review, now reads only files inside the repository under review. It refuses:
- an absolute path;
- a path that climbs out with `..`;
- a symlink in the working tree that leads outside the repo.

When a file isn't at the ref an agent asked for, the tool now says so. It used to hand back the working tree's copy instead.

## Why

The review dojo found this in its own change. After #239, a local review reads the working tree as its main path, with no check that the file stays inside the repo. A file path like `../../.ssh/id_rsa` would have been read and returned. The callers are agents reading the code under review, and that code is untrusted. A prompt injection in a diff could have used this to pull a secret into a review thread.

The fallback was quieter but also wrong: an agent that asked for a file at `HEAD` could be handed the working tree's version and never know.

## Decisions

**Refuse, don't clean up.** A path that leaves the repo is an error with a reason, not something we quietly trim back inside it. An agent asking for one is either confused or being steered, and both should see a refusal.

**Check where a symlink leads, not only how the path is written.** A path can look fine and still point outside the repo through a link, so the working-tree read resolves the real path before it opens anything.

## What we learned

Two agents agreed on this finding in the dojo's first real run on a commit. The reviewer merged before the fix, which left the bug on main for a short time. A dojo finding on your own change is worth fixing before the merge, not after.
