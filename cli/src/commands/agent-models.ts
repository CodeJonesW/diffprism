import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentModel, AgentModelLister, ReviewAgentName } from "@diffprism/core";

// ─── The models each agent can use, from its own CLI (#244) ───
//
// Read from the agent every time (cached briefly), never kept in DiffPrism: the
// list depends on the account and changes as the agents ship new models.

const execFileAsync = promisify(execFile);

/** How long a list is reused before asking the agent again. */
const MODEL_LIST_TTL_MS = 5 * 60 * 1000;
/** How long a failure is remembered, so a hung or broken CLI isn't run on every open. */
const FAILED_LIST_TTL_MS = 30 * 1000;

const stripColour = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * `cursor-agent models`: one `id - Display name` per line, after a heading,
 * with `(current, default)` after the one in use and colour codes around it.
 * Only a line whose first word is shaped like a model id counts, so a tip or
 * notice in the output never becomes a model to save.
 */
export function parseCursorModels(stdout: string): AgentModel[] {
  const models: AgentModel[] = [];
  for (const raw of stripColour(stdout).split("\n")) {
    const match = raw.trim().match(/^([a-z0-9][a-z0-9.-]*) - (.+?)(?:\s+\((?:current|default)[^)]*\))?$/);
    if (match) models.push({ id: match[1], label: match[2].trim() });
  }
  return models;
}

/** Why a CLI failed, in its own words: the first line it wrote to stderr, else the error's. */
function reasonOf(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown };
  const firstLine = (text: unknown) =>
    stripColour(String(text ?? ""))
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
  return firstLine(e.stderr) ?? firstLine(e.message) ?? String(err);
}

/**
 * Claude Code has no command that lists its models. Its help for `--model`
 * names the aliases it accepts ("e.g. 'fable', 'opus', or 'sonnet'"), each
 * the latest of its kind, so that is the list; a full model name can still be
 * typed in.
 */
export function parseClaudeModelAliases(help: string): AgentModel[] {
  const start = help.indexOf("--model <model>");
  if (start === -1) return [];
  const rest = help.slice(start + "--model <model>".length);
  const nextOption = rest.search(/\n\s{2}-/);
  const paragraph = nextOption === -1 ? rest : rest.slice(0, nextOption);
  const aliases = paragraph.match(/alias[\s\S]*?\(e\.g\.([\s\S]*?)\)/);
  if (!aliases) return [];
  return [...aliases[1].matchAll(/'([a-z][\w.-]*)'/g)].map(([, id]) => ({
    id,
    label: `${id.charAt(0).toUpperCase()}${id.slice(1)} (latest)`,
  }));
}

export interface AgentModelDeps {
  /** Runs a command and resolves with what it printed. */
  run: (command: string, args: string[]) => Promise<string>;
  now: () => number;
}

const LISTS: Record<ReviewAgentName, { command: string; args: string[]; parse: (out: string) => AgentModel[] }> = {
  claude: { command: "claude", args: ["--help"], parse: parseClaudeModelAliases },
  cursor: { command: "cursor-agent", args: ["models"], parse: parseCursorModels },
};

/**
 * The server's model lister (#244): each agent's list from its CLI, reused for
 * a few minutes. The lookup itself is what's kept, so requests that overlap
 * share one run, and a failure is remembered briefly rather than rerun on
 * every open.
 */
export function agentModelLister(deps: Partial<AgentModelDeps> = {}): AgentModelLister {
  const run =
    deps.run ?? (async (command, args) => (await execFileAsync(command, args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout);
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<ReviewAgentName, { at: number; ttl: number; list: Promise<AgentModel[]> }>();

  const load = async (agent: ReviewAgentName): Promise<AgentModel[]> => {
    const { command, args, parse } = LISTS[agent];
    let output: string;
    try {
      output = await run(command, args);
    } catch (err) {
      throw new Error(`Couldn't ask \`${command}\` for its models: ${reasonOf(err)}`);
    }
    const models = parse(output);
    if (models.length === 0) throw new Error(`\`${command} ${args.join(" ")}\` listed no models. Type one in instead.`);
    return models;
  };

  return (agent) => {
    const cached = cache.get(agent);
    if (cached && now() - cached.at < cached.ttl) return cached.list;
    const entry = { at: now(), ttl: MODEL_LIST_TTL_MS, list: load(agent) };
    cache.set(agent, entry);
    entry.list.catch(() => {
      entry.ttl = FAILED_LIST_TTL_MS;
    });
    return entry.list;
  };
}
