# Local Development & Testing

## Running from source

All CLI commands can be run directly from source using `tsx`, bypassing the installed npm version:

```bash
# Review (one-shot, blocks until submitted)
npx tsx cli/src/index.ts review --dev

# Start the global server in dev mode
npx tsx cli/src/index.ts server --dev

# Or use the pnpm alias
pnpm cli review --dev
pnpm cli server --dev
```

The `--dev` flag starts the Vite dev server with HMR, so UI changes in `packages/ui/src/` are reflected immediately without rebuilding.

## Diff ref options

```bash
# Default: working-copy mode (staged + unstaged grouped separately)
pnpm cli review --dev

# Only staged changes
pnpm cli review --dev --staged

# Only unstaged changes
pnpm cli review --dev --unstaged

# Merged view (old default, no grouping)
pnpm cli review --dev all

# Arbitrary git range
pnpm cli review --dev HEAD~3..HEAD
```

## Testing the MCP server

The MCP server runs as a separate process spawned by Claude Code. It uses the **built bundle**, not source, so changes require a rebuild:

```bash
pnpm run build
```

Then restart the MCP connection in Claude Code to pick up the new bundle.

To test the MCP server directly (outside Claude Code):

```bash
npx tsx packages/mcp-server/src/index.ts
```

## Test & type-check

```bash
# Run all tests
pnpm test

# Type-check individual packages
npx tsc --noEmit -p packages/core/tsconfig.json
npx tsc --noEmit -p packages/ui/tsconfig.json
npx tsc --noEmit -p packages/git/tsconfig.json

# Full build (compile + bundle + copy UI dist)
pnpm run build
```

## Common workflows

### UI development

1. Start the server in dev mode: `pnpm cli server --dev`
2. Edit files in `packages/ui/src/` — changes hot-reload in the browser
3. Submit a review to test the submit flow

### Backend/core changes

1. Edit source in `packages/core/`, `packages/git/`, or `packages/analysis/`
2. Run `pnpm cli review --dev` to test — tsx runs directly from source
3. Run `pnpm test` to verify

### Testing before release

```bash
pnpm test && pnpm run build
```

Both must pass before opening a PR.
