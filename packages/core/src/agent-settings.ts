import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The agents that can answer a PR review's comments (#226). */
export const REVIEW_AGENTS = ["claude", "cursor"] as const;
export type ReviewAgentName = (typeof REVIEW_AGENTS)[number];

/** The agent to answer one review, and the model it uses. No model means the agent's own default. */
export interface ReviewAgentChoice {
  name: ReviewAgentName;
  model?: string;
}

/**
 * The reviewer's standing choice: which agent answers by default, and a model
 * for each agent. Models are kept per agent because they don't carry over —
 * a Claude model name means nothing to Cursor — so switching agents and back
 * doesn't lose either one.
 */
export interface AgentSettings {
  agent: ReviewAgentName;
  models: Partial<Record<ReviewAgentName, string>>;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { agent: "claude", models: {} };

/** Where settings live — the same file that can hold a GitHub token. */
export function configFilePath(): string {
  return path.join(os.homedir(), ".diffprism", "config.json");
}

export function isReviewAgent(name: unknown): name is ReviewAgentName {
  return typeof name === "string" && (REVIEW_AGENTS as readonly string[]).includes(name);
}

function readConfigFile(): Record<string, unknown> {
  const file = configFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`${file} isn't valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The saved agent settings. Nothing saved is the default: Claude Code, with
 * its own default model. Something saved that isn't valid — an agent we don't
 * know, a model that isn't text — is an error that names the file, never a
 * silent fall back to Claude: a reviewer who chose Cursor should find out why
 * they didn't get it.
 */
export function readAgentSettings(): AgentSettings {
  const saved = readConfigFile().agent as { default?: unknown; models?: unknown } | undefined;
  if (saved === undefined) return { ...DEFAULT_AGENT_SETTINGS, models: {} };

  const file = configFilePath();
  const agent = saved.default ?? DEFAULT_AGENT_SETTINGS.agent;
  if (!isReviewAgent(agent)) {
    throw new Error(`${file}: agent.default is "${String(agent)}"; it must be one of ${REVIEW_AGENTS.join(", ")}.`);
  }

  const models: AgentSettings["models"] = {};
  for (const [name, model] of Object.entries((saved.models ?? {}) as Record<string, unknown>)) {
    if (!isReviewAgent(name)) {
      throw new Error(`${file}: agent.models has a model for "${name}", which isn't one of ${REVIEW_AGENTS.join(", ")}.`);
    }
    if (typeof model !== "string") {
      throw new Error(`${file}: agent.models.${name} must be text.`);
    }
    if (model.trim()) models[name] = model.trim();
  }
  return { agent, models };
}

/** Save agent settings, keeping everything else in the file (a GitHub token, say) as it was. */
export function writeAgentSettings(settings: AgentSettings): AgentSettings {
  if (!isReviewAgent(settings.agent)) {
    throw new Error(`Unknown agent "${String(settings.agent)}"; it must be one of ${REVIEW_AGENTS.join(", ")}.`);
  }
  const models: AgentSettings["models"] = {};
  for (const name of REVIEW_AGENTS) {
    const model = settings.models[name]?.trim();
    if (model) models[name] = model;
  }

  const config = readConfigFile();
  config.agent = { default: settings.agent, models };
  const file = configFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  return { agent: settings.agent, models };
}

/**
 * The agent for one review: what was asked for this time, over the saved
 * default. A model saved for the chosen agent comes with it, so
 * `--agent cursor` uses the Cursor model you saved.
 */
export function chooseReviewAgent(
  settings: AgentSettings,
  asked: { name?: ReviewAgentName; model?: string } = {},
): ReviewAgentChoice {
  const name = asked.name ?? settings.agent;
  const model = asked.model?.trim() || settings.models[name];
  return model ? { name, model } : { name };
}
