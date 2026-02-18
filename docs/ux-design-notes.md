# UX Design Notes

Living document capturing user experience observations, design decisions, and expected behavior for DiffPrism. Updated continuously as the tool evolves.

---

## CLI Defaults

### Default diff scope (v0.2.6)
- **Decision:** `diffprism review` with no flags defaults to `"all"` (staged + unstaged via `git diff HEAD`)
- **Rationale:** Most users edit files and run the review without staging first. Defaulting to `"staged"` caused "No changes to review" confusion. Explicit `--staged` and `--unstaged` flags still available for narrower scope.
- **Issue:** [#6](https://github.com/CodeJonesW/diffprism/issues/6)

---

## Review UI

### Current state (M0)
- Dark mode only, GitHub dark theme colors
- Unified diff view with syntax highlighting (refractor)
- Two actions: Approve / Request Changes
- No inline commenting yet

### Observations
- (Add observations here as they arise from real usage)

---

## MCP Integration

### Setup simplicity (v0.2.x)
- Published to npm so MCP config is just `npx diffprism serve` — no cloning, no path dependencies
- `silent: true` is critical to prevent stdout from corrupting MCP stdio protocol

---

## Pain Points & Open Questions

- (Capture friction points from real usage sessions here)

---

## Design Principles

1. **Zero-config for common cases** — sensible defaults, flags for overrides
2. **Fast feedback loop** — browser opens immediately, result returns as JSON
3. **Local-first** — no accounts, no cloud, everything runs on the user's machine
4. **Agent-friendly** — structured input/output, MCP integration, silent mode for automation
