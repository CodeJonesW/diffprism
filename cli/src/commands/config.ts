import {
  REVIEW_AGENTS,
  configFilePath,
  isReviewAgent,
  readAgentSettings,
  writeAgentSettings,
} from "@diffprism/core";
import type { AgentSettings, ReviewAgentName } from "@diffprism/core";

/**
 * The settings `diffprism config` reads and writes (#226): which agent
 * answers PR reviews by default, and a model for each agent. The dashboard's
 * settings change the same file.
 */
export const CONFIG_KEYS = ["agent", ...REVIEW_AGENTS.map((name) => `${name}.model`)] as const;

const LABELS: Record<ReviewAgentName, string> = { claude: "Claude Code", cursor: "Cursor" };

/** The agent a `<agent>.model` key is about, or null for any other key. */
function modelKey(key: string): ReviewAgentName | null {
  const name = key.endsWith(".model") ? key.slice(0, -".model".length) : null;
  return isReviewAgent(name) ? name : null;
}

function unknownKey(key: string): never {
  throw new Error(`Unknown setting "${key}". Settings: ${CONFIG_KEYS.join(", ")}.`);
}

function show(settings: AgentSettings, key: string): string {
  if (key === "agent") return settings.agent;
  const name = modelKey(key) ?? unknownKey(key);
  return settings.models[name] ?? `(${LABELS[name]}'s default)`;
}

/** Run a config action, turning a bad key or value into a message and exit code 1. */
function run(action: () => void): void {
  try {
    action();
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export function configGet(key?: string): void {
  run(() => {
    const settings = readAgentSettings();
    if (key) {
      console.log(show(settings, key));
      return;
    }
    const width = Math.max(...CONFIG_KEYS.map((k) => k.length));
    for (const k of CONFIG_KEYS) console.log(`${k.padEnd(width)}  ${show(settings, k)}`);
    console.log(`\nSaved in ${configFilePath()}`);
  });
}

export function configSet(key: string, value: string): void {
  run(() => {
    const settings = readAgentSettings();
    if (key === "agent") {
      if (!isReviewAgent(value)) {
        throw new Error(`"${value}" isn't an agent DiffPrism can start. Choose one of: ${REVIEW_AGENTS.join(", ")}.`);
      }
      settings.agent = value;
    } else {
      const name = modelKey(key) ?? unknownKey(key);
      settings.models[name] = value;
    }
    const saved = writeAgentSettings(settings);
    console.log(`${key} = ${show(saved, key)}`);
  });
}

export function configUnset(key: string): void {
  run(() => {
    const settings = readAgentSettings();
    if (key === "agent") {
      settings.agent = "claude";
    } else {
      const name = modelKey(key) ?? unknownKey(key);
      delete settings.models[name];
    }
    const saved = writeAgentSettings(settings);
    console.log(`${key} = ${show(saved, key)}`);
  });
}
