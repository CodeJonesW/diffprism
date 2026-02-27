# DiffPrism Product Plan Discussion — 2026-02-27

Conversation between Will and Claude about the brittleness of the current integration model and strategic direction for making DiffPrism ripe for the future of agentic programming.

---

## The Problem Statement

DiffPrism relies on Claude skills and MCP to call the review tool. This is brittle — sometimes the flow works well, but often requires steering the model to use it correctly. The current approach puts the model in a box rather than meeting it where it naturally operates.

The demand to solve: **engineers need to validate agent code.** The goal is to enable agents to review their own code and humans to use agents to review their code. The question is what architecture makes this natural rather than forced.

---

## Diagnosis: Why the Current Approach is Brittle

The brittleness comes from a specific architectural bet: **the model is the orchestrator.** The skill file is a 130-line prompt that says "check for watch mode, then read config, then call this tool with these params, then handle the result, and if the result has a postReviewAction do this other thing..." That's a script. And models are unreliable script executors.

When it works, it's magic. When it doesn't, you're steering. And the more edge cases you add (watch mode vs global server vs ephemeral, config files, self-review loops), the more fragile the orchestration becomes.

The thing is — this problem is **already solved in the MCP layer** for some cases. `open_review` internally detects the global server, routes appropriately, handles polling. The model doesn't know or care about that routing. It just calls one tool and gets a result. That's the right pattern.

### What models actually want

Models want to call **one tool that does the thing.** They're great at deciding *when* to use a tool and passing reasonable parameters. They're bad at multi-step orchestration with conditionals.

Right now the flow is:
```
Model reads skill → Model checks watch file → Model picks tool → Model calls tool →
Model reads result → Model interprets postReviewAction → Model executes action
```

The natural flow should be:
```
Model calls tool → Gets result
```

Everything in between should be infrastructure, not model responsibility.

---

## Three Strategic Ideas

### 1. The Review Server as the Product

The global server (`localhost:24680`) is already an HTTP API that accepts `POST /api/reviews` and returns results. That's the actual product interface. MCP is just one client. The skill is just a prompt that teaches Claude to be a client.

What if we leaned all the way into this? The review server is always running (background daemon, launchd/systemd, or auto-started). Any agent — Claude Code, Cursor, Devin, a bash script, a CI pipeline — can POST a review. The review UI is always one click away.

This decouples from MCP's constraints entirely. MCP becomes one thin adapter among many, not the primary integration point. A Claude Code hook that auto-POSTs on certain events. A git hook that POSTs on pre-push. A VS Code extension that POSTs from a button click. The HTTP API is the universal language agents already speak.

### 2. Flip the Trigger: Watch by Default

The watch mode idea is right but it's implemented as a separate flow the model has to know about. What if watching is the default?

The server watches the git repo. When changes appear, it updates the review UI automatically. The agent doesn't need to call anything — it just writes code. The human has a persistent review surface that's always showing the current state of changes.

When the agent *does* want to push context (reasoning, title), it makes a simple HTTP POST. But the trigger isn't the agent calling `open_review` — the trigger is *code changing on disk*.

This is essentially the Gerrit model: the review surface exists independently of the code-producing agent. The agent's job is to write code. The review surface's job is to show it.

### 3. The Agent SDK Play

Instead of MCP tools + skill prompts, ship a `@diffprism/agent` package that's a simple TypeScript/Python SDK:

```typescript
import { DiffPrism } from "@diffprism/agent"

const dp = new DiffPrism()  // auto-discovers local server

// Agent self-review (headless)
const briefing = await dp.analyze("working-copy")
if (briefing.patterns.length > 0) { /* fix issues */ }

// Request human review (blocks)
const result = await dp.review("working-copy", {
  reasoning: "Refactored auth middleware"
})

// result.decision === "approved" | "changes_requested" | ...
```

This is what agents built with the Claude Agent SDK, or any custom agent framework, would actually import. MCP is great for Claude Code specifically, but the agent ecosystem is going to be way broader than MCP. A simple library that discovers the local server and provides typed methods is more universal than any protocol.

---

## What to Keep vs Tear Down

### Keep
- **The review UI** — it's the moat. Nothing else gives you a browser-grade diff viewer for pre-commit review.
- **The global server + HTTP API** — this IS the product interface.
- **The analysis engine** — 10 deterministic functions that work.
- **The WebSocket bridge** for live updates.

### Reconsider
- **The skill file as the primary integration point.** It's 130 lines of "please do this correctly" and models often don't.
- **Watch mode as a separate flow.** It should be a server behavior, not a client-side detection.
- **MCP as the primary agent interface.** It's *one* interface, not *the* interface.
- **The ephemeral mode.** Does anyone actually want a brand new Vite server spun up per review? The global server is better in every way.

### Tear Down
- **The assumption that the model orchestrates the review flow.** The server should orchestrate. The model should just signal intent.

---

## Reframing the Three Postures

The product plan describes three agent postures. But right now all three are gated behind "the model correctly calls MCP tools." What if the architecture was:

### Posture 1: Human validates agent code
Server watches repo, shows changes. Agent optionally pushes reasoning. Human reviews when ready. **No model orchestration required.**

### Posture 2: Agent reviews its own code
Agent imports SDK, calls `analyze()`. No browser, no MCP, no skill. Pure library call. **The integration is a function call, not a protocol.**

### Posture 3: Human uses agents as reviewers
Human opens review in UI, clicks "ask agent to review this file." Server sends diff to agent API, agent responds with annotations. **The UI triggers the agent, not the other way around.**

Each posture has a *different* integration surface. Trying to route all three through MCP + skill prompts is the source of the brittleness.

---

## Open Questions

- How much of the current MCP/skill infrastructure should be preserved as one integration path vs deprecated entirely?
- Is the always-running daemon model right for local-first? Or is it too heavy?
- What's the minimal viable version of "flip the trigger" — could watch-by-default be the next release?
- How does the agent SDK play interact with the Claude Agent SDK specifically?
- Should ephemeral mode be killed, or does it serve the zero-config first-run experience?

---

*Next step: Pick a direction and draft a revised technical plan.*
