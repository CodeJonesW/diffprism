---
name: align
description: Use when user says "check alignment", "are we on track", "plan check",
  "alignment report", or invokes /align — deep consistency check across product plan,
  technical plan, CLAUDE.md roadmap, and current work
---

# Plan Alignment Check

Run all five steps in order. Present a single structured report at the end.

## Step 1: Read the Plans

Read these three sources in full:
- `product-plan.md` — strategic product vision and milestones
- `diffprism-technical-plan.md` — technical architecture and implementation plan
- The `## Roadmap` section of `CLAUDE.md` — active milestone tracker

Internalize the current milestones, their status, and what work is planned vs completed.

## Step 2: Inspect Current Work

Run these read-only commands to understand what's in flight:

```bash
git branch --show-current
git log --oneline -10
git diff --stat HEAD~5..HEAD
git status
gh issue list --state open --limit 30
```

Identify: current branch, recent commits, open issues, and any uncommitted work.

## Step 3: Check Internal Consistency

Compare the three sources from Step 1 against each other:

- Do `product-plan.md` phases match `diffprism-technical-plan.md` milestones?
- Does the `CLAUDE.md` `## Roadmap` reflect the current state of both plans?
- Are completed items marked consistently across all three?
- Are issue numbers referenced correctly?
- Is the build order / dependency ordering consistent?

Note any contradictions, stale entries, or gaps.

## Step 4: Produce Alignment Report

Output a structured report with these sections:

```
## Alignment Report

### Active Milestones
- List each active milestone with completion % and remaining items

### Current Work Mapping
- Map the current branch / recent commits to a specific milestone and issue
- Flag if current work doesn't map to any active milestone

### Plan Consistency
- ✅ or ❌ for each consistency check from Step 3
- Details on any inconsistencies found

### Misalignment Findings
- Any work outside active milestones
- Any plan contradictions
- Any stale roadmap entries
- Any open issues that don't map to a milestone

### Recommended Actions
- Specific next steps to resolve any misalignment
- Plan updates needed (if any)
- Suggested priority for remaining milestone work
```

## Step 5: Open Discussion

If misalignment was found, present the findings and ask:
- Should the **plans be updated** to reflect the current direction?
- Should the **work be adjusted** to realign with the plans?
- Is this intentional deviation that should be documented?

If everything is aligned, confirm it and suggest the highest-priority next task from the active milestones.
