# Landing Page Update Prompt

> Paste the prompt below into Claude when working in `~/dev/diffprism-landing`.

---

I need you to rebuild the DiffPrism landing page. DiffPrism is now a **GitHub App that delivers pattern-aware code reviews directly on pull requests**. The previous npm package and local CLI tool have been deprecated. The landing page should focus entirely on the GitHub App.

## What DiffPrism Is

DiffPrism is a **GitHub App** that reviews pull requests with deep awareness of your codebase's existing patterns. When a developer comments `/review` on a PR, DiffPrism:

1. Fetches the diff
2. Queries a vector database of your indexed codebase for semantically related code
3. Sends the diff + repo context to Claude
4. Posts structured inline review comments directly on the PR

The core differentiator: **reviews are pattern-aware.** DiffPrism can say "this error handling differs from the pattern in `src/api/auth.ts:42`" because it has indexed your repo — not just the diff in isolation.

## How It Works

### For the Developer
1. Install the DiffPrism GitHub App on your repo
2. DiffPrism automatically indexes your codebase (AST-aware chunking, vector embeddings)
3. Comment `/review` on any PR
4. DiffPrism posts a review with inline comments tagged by severity:
   - Red: Critical (bugs, security issues, broken patterns)
   - Yellow: Suggestion (consistency improvements, pattern deviations)
   - Green: Praise (genuinely good patterns — used sparingly)
5. Clean code gets a clean approval — no filler comments, no noise

### Pattern-Aware Context Pipeline
When a review is triggered:
1. Parse the diff → extract changed files and added lines
2. Build a semantic query from the diff
3. Query Vectorize for related code patterns (filtered to this repo only)
4. Query the import graph for files connected to the changed files
5. Send both the diff and the context to Claude
6. Claude references actual codebase patterns in its review comments

### Repo Indexing
- **On install** — full repo indexed automatically
- **On push to main** — incremental re-indexing of changed files
- **AST-aware chunking** — code is split at function/class boundaries, not arbitrary character counts
- Indexing a mid-size TypeScript project takes ~15 seconds

### Usage Tiers

| Plan | Reviews/month | Context depth | Repos |
|---|---|---|---|
| Free | 10 | 5 chunks | 1 |
| Pro | 100 | 15 chunks | Unlimited |
| Team | Unlimited | 20 chunks | Unlimited |

## Landing Page Structure

### Hero Section
- **Headline:** Something like "Code review that knows your codebase" or "Pattern-aware code reviews for GitHub"
- **Subheading:** DiffPrism indexes your repo and reviews PRs with awareness of your existing patterns, conventions, and architecture. Not just correctness — consistency.
- **Badge:** "GitHub App · Pattern-aware · Powered by Claude"
- **Primary CTA:** "Install on GitHub" (link to GitHub App installation page)
- No secondary CTA. No npm references. The GitHub App is the only product.

### Demo Section
- Show the `/review` comment → DiffPrism review flow on a real PR
- Show an example inline comment that references a pattern from elsewhere in the codebase
- Emphasize: zero context switching. Reviews appear directly on the PR.

### How It Works
Three steps:
1. **Install** — Add DiffPrism to your GitHub repo. Your codebase is indexed automatically.
2. **Review** — Comment `/review` on any PR. DiffPrism fetches the diff, finds related patterns, and sends both to Claude.
3. **Ship** — Read the review, address critical findings, merge with confidence. Clean PRs get clean approvals.

### What Makes It Different
- **Pattern-aware** — Not just "is this code correct?" but "does this code match how you do things?"
- **Zero noise** — Clean code gets a clean approval. No filler comments, no praise-for-the-sake-of-it.
- **Contextual** — References specific files and lines from your codebase, not generic advice.
- **Fast** — Reviews complete in ~10 seconds. Async queue processing means no webhook timeouts.
- **Scoped** — Your code context is isolated per repo. No cross-contamination between repos.

### Features Grid
- **`/review` command** — Comment on any PR to trigger a review. On-demand, not automatic noise.
- **Pattern-aware reviews** — Vector search finds related code patterns from your repo for every review.
- **AST-aware indexing** — Code chunked at function/class boundaries, not arbitrary character splits.
- **Severity-tagged comments** — Critical, suggestion, praise with visual indicators on the PR.
- **Incremental indexing** — Only changed files are re-indexed when you push to main.
- **Usage tiers** — Free tier with 10 reviews/month. Scales to unlimited for teams.

### Architecture Diagram
```
Developer comments /review on PR
        ↓
GitHub webhook → DiffPrism Worker
        ↓
Queue → Fetch diff + Query context (Vectorize)
        ↓
Claude reviews with repo awareness
        ↓
Inline comments posted to PR
```

### Pricing Section
Show the three tiers (Free / Pro / Team) with the limits from the table above.

### CTA (Bottom)
- "Install DiffPrism" → GitHub App installation URL
- Keep it single-action. No npm commands, no CLI setup.

## Tone & Style Guidelines
- Lead with the problem: "AI code review tools don't know your codebase. DiffPrism does."
- Emphasize pattern-awareness as the key differentiator over generic AI review tools
- Zero noise — DiffPrism doesn't comment for the sake of commenting
- Keep it concise — tight copy, no filler
- Maintain the existing dark theme visual style
- Don't oversell — stick to what's shipped and working

## What to Remove
- **All npm/CLI references** — no `npx diffprism`, no `npm install`, no CLI commands
- **All local tool features** — no MCP tools, no browser-based review UI, no multi-session dashboard, no agent self-review
- **All Watch Mode content** — deprecated
- **npm links** — remove from nav/footer
- The previous product (local review tool) is fully deprecated. Do not reference it.

## What NOT to Change
- Don't touch the Why page or Blog page (yet — they may need separate updates later)
- Don't change the visual design system (colors, fonts, layout patterns)
- Keep the GitHub link
- Keep dark/light mode toggle

## Reference: Complete GitHub App Feature Set
- GitHub App installation → automatic account + repo creation
- `/review` PR comment trigger for on-demand reviews
- Async queue-based review processing (~10 second reviews)
- Pattern-aware reviews via Vectorize semantic search + import graph analysis
- Severity-tagged inline comments (critical, suggestion, praise)
- Clean approvals with summary body for passing code
- Usage tracking with free/pro/team tiers
- AST-aware repo indexing (function/class boundaries, not character splits)
- Incremental re-indexing on push to default branch
- Automatic indexing on app installation
- Per-repo data isolation in vector database
- HMAC webhook signature verification
- Installation token caching (50min TTL)
- Cloudflare Workers + D1 + Vectorize + Queues + KV + Workers AI
- Service binding architecture (worker-to-worker, no public internet hop)
- Claude API for review generation with structured JSON output
