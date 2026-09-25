import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configGet, configSet, configUnset } from "../commands/config.js";

// #226: `diffprism config` — the CLI side of choosing the review agent.
describe("diffprism config", () => {
  let home: string;
  const configFile = () => path.join(home, ".diffprism", "config.json");
  const saved = () => JSON.parse(fs.readFileSync(configFile(), "utf-8"));
  const printed = () => vi.mocked(console.log).mock.calls.flat().join("\n");

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "dp-config-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("shows every setting, and the defaults when nothing is saved", () => {
    configGet();
    expect(printed()).toMatch(/agent\s+claude/);
    expect(printed()).toMatch(/claude\.model\s+\(Claude Code's default\)/);
    expect(printed()).toMatch(/cursor\.model\s+\(Cursor's default\)/);
  });

  it("sets the default agent and a model per agent, keeping the rest of the file", () => {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify({ github: { token: "keep-me" } }));

    configSet("agent", "cursor");
    configSet("cursor.model", "gpt-5");
    configSet("claude.model", "opus");

    expect(saved()).toEqual({
      github: { token: "keep-me" },
      agent: { default: "cursor", models: { cursor: "gpt-5", claude: "opus" } },
    });
  });

  it("shows one setting", () => {
    configSet("cursor.model", "gpt-5");
    vi.mocked(console.log).mockClear();

    configGet("cursor.model");
    expect(printed()).toBe("gpt-5");
  });

  it("puts a setting back to its default", () => {
    configSet("agent", "cursor");
    configSet("claude.model", "opus");

    configUnset("agent");
    configUnset("claude.model");

    expect(saved().agent).toEqual({ default: "claude", models: {} });
  });

  it("refuses an agent it can't start, and fails", () => {
    configSet("agent", "copilot");

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"copilot" isn\'t an agent DiffPrism can start'));
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(fs.existsSync(configFile())).toBe(false);
  });

  it("refuses a setting it doesn't have, and fails", () => {
    configSet("copilot.model", "x");

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown setting "copilot.model"'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
