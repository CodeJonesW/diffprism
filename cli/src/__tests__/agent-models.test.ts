import { describe, it, expect, vi } from "vitest";
import { agentModelLister, parseClaudeModelAliases, parseCursorModels } from "../commands/agent-models.js";

// ─── #244: the models each agent can use, from its own CLI ───

// As `cursor-agent models` prints them: a heading, colour codes, and a marker on the one in use.
const cursorOutput = [
  "\x1b[2mAvailable models\x1b[22m",
  "",
  "\x1b[32mauto\x1b[39m \x1b[2m- Auto\x1b[22m\x1b[2m (current, default)\x1b[22m",
  "\x1b[36mgpt-5.3-codex\x1b[39m \x1b[2m- Codex 5.3\x1b[22m",
  "\x1b[36mclaude-opus-5-5-high-fast\x1b[39m \x1b[2m- Claude Opus 5.5 1M High Fast\x1b[22m",
  "",
].join("\n");

// The `--model` paragraph of `claude --help`, and the option after it.
const claudeHelp = [
  "  --mcp-config <configs...>             Load MCP servers from JSON files or strings",
  "  --model <model>                       Model for the current session. Provide",
  "                                        an alias for the latest model (e.g.",
  "                                        'fable', 'opus', or 'sonnet') or a",
  "                                        model's full name (e.g.",
  "                                        'claude-fable-5').",
  "  --permission-mode <mode>              Permission mode to use for the session",
].join("\n");

describe("parseCursorModels", () => {
  it("reads each id and name, without colour codes or the in-use marker", () => {
    expect(parseCursorModels(cursorOutput)).toEqual([
      { id: "auto", label: "Auto" },
      { id: "gpt-5.3-codex", label: "Codex 5.3" },
      { id: "claude-opus-5-5-high-fast", label: "Claude Opus 5.5 1M High Fast" },
    ]);
  });
});

describe("parseCursorModels, strictly", () => {
  it("takes only lines that start with a model id, not a tip or notice shaped the same", () => {
    const noisy = `${cursorOutput}\nTip - run cursor-agent login to see more models\nNote: models - may change\n`;
    expect(parseCursorModels(noisy).map((m) => m.id)).toEqual(["auto", "gpt-5.3-codex", "claude-opus-5-5-high-fast"]);
  });
});

describe("parseClaudeModelAliases", () => {
  it("reads the aliases Claude Code's help names, not the full-name example", () => {
    expect(parseClaudeModelAliases(claudeHelp)).toEqual([
      { id: "fable", label: "Fable (latest)" },
      { id: "opus", label: "Opus (latest)" },
      { id: "sonnet", label: "Sonnet (latest)" },
    ]);
  });

  it("finds nothing in help that has no --model", () => {
    expect(parseClaudeModelAliases("  --verbose  Say more")).toEqual([]);
  });
});

describe("agentModelLister", () => {
  it("asks each agent's own CLI, and reuses the answer for a few minutes", async () => {
    let clock = 0;
    const run = vi.fn(async (command: string) => (command === "cursor-agent" ? cursorOutput : claudeHelp));
    const list = agentModelLister({ run, now: () => clock });

    expect((await list("cursor")).map((m) => m.id)).toEqual(["auto", "gpt-5.3-codex", "claude-opus-5-5-high-fast"]);
    expect((await list("claude")).map((m) => m.id)).toEqual(["fable", "opus", "sonnet"]);
    expect(run.mock.calls).toEqual([
      ["cursor-agent", ["models"]],
      ["claude", ["--help"]],
    ]);

    await list("cursor");
    expect(run).toHaveBeenCalledTimes(2);
    clock += 5 * 60 * 1000;
    await list("cursor");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("says why when the agent can't list them", async () => {
    const list = agentModelLister({
      run: async () => {
        throw new Error("spawn cursor-agent ENOENT\nmore detail");
      },
    });
    await expect(list("cursor")).rejects.toThrow("Couldn't ask `cursor-agent` for its models: spawn cursor-agent ENOENT");
  });

  it("gives the agent's own reason from what it wrote to stderr", async () => {
    const list = agentModelLister({
      run: async () => {
        throw Object.assign(new Error("Command failed: cursor-agent models\n"), { stderr: "\x1b[31mError: not logged in\x1b[0m\nrun cursor-agent login" });
      },
    });
    await expect(list("cursor")).rejects.toThrow("Couldn't ask `cursor-agent` for its models: Error: not logged in");
  });

  it("shares one run between requests that overlap", async () => {
    let finish = (_out: string) => {};
    const run = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const list = agentModelLister({ run });

    const first = list("cursor");
    const second = list("cursor");
    finish(cursorOutput);

    expect(await first).toEqual(await second);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("remembers a failure briefly, rather than rerunning a broken CLI on every open", async () => {
    let clock = 0;
    const run = vi.fn(async () => {
      throw new Error("timed out");
    });
    const list = agentModelLister({ run, now: () => clock });

    await expect(list("cursor")).rejects.toThrow("timed out");
    await expect(list("cursor")).rejects.toThrow("timed out");
    expect(run).toHaveBeenCalledTimes(1);

    clock += 30_000;
    await expect(list("cursor")).rejects.toThrow("timed out");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("says so when the agent printed no models, rather than offering an empty list", async () => {
    const list = agentModelLister({ run: async () => "Not logged in" });
    await expect(list("cursor")).rejects.toThrow("`cursor-agent models` listed no models. Type one in instead.");
  });
});
