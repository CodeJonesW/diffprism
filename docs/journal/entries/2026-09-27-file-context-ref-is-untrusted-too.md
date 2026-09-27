---
title: An agent's ref is untrusted too, and so are the files around the repo
date: 2026-09-27
kind: fix
---

## What changed

`get_file_context`, the tool agents use to read whole files, now treats the revision an agent asks for as carefully as the file name:
- A ref that starts with `-` or contains `:` is refused, and git is told that nothing after a marker is an option.
- Nothing under `.git` can be read, directly or through a symlink.
- A file name that only escapes the repo on Windows (`C:..\..\Windows\win.ini`) is refused.
- A named pipe in the repo is refused instead of hanging the read, and so is a file over 10 MB.

Errors say what actually went wrong. "File not found" means git says it's missing; a revision that doesn't exist, or a file too large to read, now says that. A local review that doesn't record which diff it shows gets an error instead of a guess at `HEAD`.

## Why

The review dojo ran on the fix that confined file names to the repo (#260), and both agents found the same hole: the ref. The tool pasted the agent's ref into `git show` as-is, and git reads anything starting with `-` as an option. We tried it: `ref: "--output=…"` made git write a file to a path the caller chose. That's the same prompt injection #260 was guarding against, through the door next to it.

## Decisions

**Refuse at the edge, and make git safe anyway.** Refusing a ref that starts with `-` gives the agent a clear reason. `--end-of-options` means git can't take the ref as an option even if a check misses a case. We kept both.

**One answer for "missing" and "outside".** A symlink leading out of the repo used to say "leads outside" when its target existed, and "not found" when it didn't, which told a caller whether a file existed anywhere on the machine. Now both get the same message.

**Gitignored files stay readable, for now.** A `.env` inside the repo can still be read. One agent called that a major gap. The other pointed out that a review of uncommitted changes may be judging an untracked file, which a tracked-files-only rule would hide. It's left open in #263 as a decision, with `.git` closed off meanwhile.

## What we learned

A security fix deserves its own review. The dojo on #260 found a worse hole than the one #260 closed, in the argument right beside it. Guarding one input from an attacker says nothing about the others they control.
