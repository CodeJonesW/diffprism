---
title: The dojo times each agent on its own, and models are picked from a list
date: 2026-09-27
kind: feature
pr: 278
---

## What changed

**Each agent's own time.** In a review dojo, every agent's timer stops when its own review is in. A card reads "Waiting for Cursor · raised 2 · reviewed in 0:51", while Cursor's keeps counting. The results list every agent with the model it ran on and its times: "Claude Code · default model — reviewed in 0:51, voted in 0:20 · Cursor · gpt-5.3-codex — reviewed in 6:12, voted in 1:05".

**Models from a list.** The **Review agent** settings pick each agent's model from what that agent offers, instead of a text box:
- **Cursor** lists every model the account can use (241 on ours), grouped by family, so the effort levels and fast variants of a model sit together.
- **Claude Code** offers the models its `--model` help names.
- **Other…** takes any other name, and if an agent can't list its models, you type one in and the settings say why.

## Why

Dogfooding the dojo, Claude Code finished its review in 51 seconds while Cursor, on its "Auto" model, was still thinking after five and a half minutes. Both cards read "4:51", so the only way to see the difference was to dig through the agents' own transcripts. Picking a faster model for Cursor then meant knowing its exact name, with nothing to choose from.

## Decisions

**Ask the agent for its models; don't keep a list.** The models depend on the account and change every few weeks. Cursor has a command for them. Claude Code doesn't, but its help names the aliases it accepts, and reading them from there keeps up with Claude Code's releases without a list in DiffPrism to go stale.

**A time means little without its model.** So the results say which model each agent ran on, and "default model" when none was set.

## What we learned

`claude models` isn't a command. Claude Code takes an unknown word as a prompt, and started answering "The current Claude models are: …". Check a CLI's help before trying a subcommand you only expect to exist.
