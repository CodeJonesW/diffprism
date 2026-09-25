# Contributing to DiffPrism

Thanks for helping make DiffPrism better. Bug reports, ideas, docs fixes, and
code are all welcome.

## Before you start

- **Found a bug or have an idea?** Open an issue at
  https://github.com/CodeJonesW/diffprism/issues. `diffprism feedback --bug`
  prefills one with your version and environment.
- **Planning a larger change?** Open an issue first so we can agree on the
  approach before you spend time on it.

## Sign the CLA

Every contributor must sign the [Contributor License Agreement](CLA.md)
before a pull request can be merged. It takes one comment: when you open your
first PR, a bot will ask you to reply with

```
I have read the CLA Document and I hereby sign the CLA
```

and that covers all your future contributions too.

DiffPrism is released under the [Apache License 2.0](LICENSE), and your
contributions will be too.

**Why a CLA?** You keep the copyright to your work. The CLA gives the project
owner permission to use it, including under a different license later. That
keeps DiffPrism's licensing flexible, so the project can change how it's
licensed or offer paid features that fund its development without having to
track down every past contributor for permission. It also confirms that you
have the right to contribute the code you're submitting, which protects
everyone who uses DiffPrism.

## Development setup

Requires Node.js >= 20, pnpm 9, and Git.

```bash
git clone https://github.com/CodeJonesW/diffprism.git
cd diffprism
pnpm install
pnpm run build
```

See the [Dev Testing Guide](docs/usage/dev-testing.md) for running DiffPrism
from source.

## Making a change

1. Branch from the latest `main`.
2. Make a focused change, following the existing conventions (ESM, named
   exports, kebab-case file names). `CLAUDE.md` describes the codebase.
3. Add a build journal entry in `docs/journal/entries/` describing what
   changed and why. The format is in
   [`docs/journal/README.md`](docs/journal/README.md).
4. Make sure everything passes:

   ```bash
   pnpm test
   pnpm run build
   pnpm docs:check
   pnpm journal check
   ```

   If you changed a command, flag, tool, or file path, `docs:check` points at
   every doc that still describes the old one. Update them in the same PR.

## Opening a pull request

- Start the PR title with `patch:`, `minor:`, or `major:` to say how big the
  change is (for example, `patch: fix typo in readme`). CI checks for it, and
  merging a PR with one of these prefixes publishes a release.
- Describe what changed and why.
- Sign the CLA when the bot asks.

## Trademarks

The DiffPrism name and logo are covered by the
[trademark policy](TRADEMARKS.md), not the code license. If you publish a
modified fork, give it a different name.
