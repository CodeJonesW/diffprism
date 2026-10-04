---
title: DiffPrism's tools in every repository and worktree, set up once
date: 2026-10-04
kind: fix
---

## What changed

`diffprism setup --global` now registers DiffPrism's MCP server with Claude Code for every project, through Claude Code's own `claude mcp add-json --scope user`. Any repository, and any worktree of one, has DiffPrism's tools, the `/review` skill and its permissions, with nothing set up per repository. It registers `diffprism serve`, so it runs whichever DiffPrism is on your PATH: your dev build, if you've linked one (#200). Without Claude Code's `claude` command, setup says the tools couldn't be registered and why, and doesn't claim otherwise.

`diffprism doctor` reports the MCP server for every project.

The commit gate needed nothing new: git keeps one hooks folder for a repository and all its worktrees, so one `diffprism hook install` per repository already gates every worktree of it.

## Why

Working with agents means a new git worktree for nearly every task, and DiffPrism didn't follow. Its tools came from a repository's `.mcp.json`, and `diffprism setup` puts that file in `.gitignore`, so a new worktree never had it. The agent there knew nothing about DiffPrism until you told it. In the end it was easier not to use DiffPrism at all, which went on for two days before this.

It worked in DiffPrism's own repository only because its `.mcp.json` happens to be committed.

## Decisions

**Global, not per repository.** Claude Code can register an MCP server for every project, and DiffPrism's skill and permissions were already global. A worktree has no setup step to run, so anything per repository would always be missing from the next one.

**Written through Claude Code's CLI, and only ever added.** Claude Code's config file is Claude Code's, rewritten by it all the time. DiffPrism reads it to see whether its server is registered, and changes it only through `claude mcp`. That happens in `diffprism setup --global` and `diffprism doctor --fix`, never in the server's automatic repair: the commit gate starts the server in the background, often from inside a Claude Code session. Setup adds a registration when there's none, and never replaces one, so a registration you set up on purpose, for a dev build say, stays.

**A command, not a path.** The registration outlives whatever ran setup. A path into an npx cache, a worktree or one Node version would break DiffPrism's tools everywhere once it went away, so it registers `diffprism serve`, or the npm release through npx when `diffprism` isn't installed (through `cmd /c` on Windows, where both are `.cmd` shims).

**No global commit gate, after all.** We built one first: git's global `core.hooksPath` pointed at a folder of DiffPrism's, passing every hook through to each repository's own. Four rounds of the dojo's review kept finding what that breaks:
- hook installers stop working, such as `pre-commit install` and `git lfs install` (so LFS uploads quietly stop);
- some hooks change git's behaviour just by existing;
- hooks that run on everyday commands cost a process each time;
- repositories that receive pushes are affected too.

Taking over git's global hook setting has too much reach for one tool. The global version is written up as #296, with what the review found.

## What we learned

The worktree problem was never the gate. It was everything that came from files in `.gitignore`.

Seven rounds of review taught us something about scope, too. Each round's fixes were new code: replacing an existing registration, carrying its settings over, putting it back on failure, and every corner of git's hooks path. The next round found the corners of that code. The rounds converged only once we cut the change back to what fixed the problem: add a registration when there's none, and leave the gate as it was. Handling an edge case adds code, and new code has edge cases of its own. Sometimes not having the feature at all is the better answer.
