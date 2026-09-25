import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readAgentSettings,
  writeAgentSettings,
  chooseReviewAgent,
  configFilePath,
  DEFAULT_AGENT_SETTINGS,
} from "../agent-settings.js";

describe("agent settings (#226)", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "dp-settings-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const writeConfig = (config: unknown) => {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(configFilePath(), JSON.stringify(config));
  };

  it("is Claude Code with its own model when nothing is saved", () => {
    expect(readAgentSettings()).toEqual(DEFAULT_AGENT_SETTINGS);
  });

  it("reads what was saved", () => {
    writeConfig({ agent: { default: "cursor", models: { cursor: "gpt-5", claude: "opus" } } });
    expect(readAgentSettings()).toEqual({ agent: "cursor", models: { cursor: "gpt-5", claude: "opus" } });
  });

  // Someone who chose Cursor should find out why they got something else.
  it("refuses an agent it doesn't know, naming the file", () => {
    writeConfig({ agent: { default: "copilot" } });
    expect(() => readAgentSettings()).toThrow(/config\.json: agent\.default is "copilot"/);
  });

  it("refuses a model that isn't text", () => {
    writeConfig({ agent: { models: { claude: 4 } } });
    expect(() => readAgentSettings()).toThrow(/agent\.models\.claude must be text/);
  });

  it("refuses a file that isn't JSON", () => {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(configFilePath(), "{ not json");
    expect(() => readAgentSettings()).toThrow(/isn't valid JSON/);
  });

  it("saves without touching the rest of the file", () => {
    writeConfig({ github: { token: "keep-me" } });

    writeAgentSettings({ agent: "cursor", models: { cursor: " gpt-5 ", claude: "" } });

    expect(JSON.parse(fs.readFileSync(configFilePath(), "utf-8"))).toEqual({
      github: { token: "keep-me" },
      agent: { default: "cursor", models: { cursor: "gpt-5" } },
    });
    expect(readAgentSettings()).toEqual({ agent: "cursor", models: { cursor: "gpt-5" } });
  });

  describe("choosing the agent for one review", () => {
    const settings = { agent: "claude" as const, models: { claude: "opus", cursor: "gpt-5" } };

    it("is the saved default, with its model", () => {
      expect(chooseReviewAgent(settings)).toEqual({ name: "claude", model: "opus" });
    });

    it("brings the model saved for the agent asked for", () => {
      expect(chooseReviewAgent(settings, { name: "cursor" })).toEqual({ name: "cursor", model: "gpt-5" });
    });

    it("lets a model asked for win", () => {
      expect(chooseReviewAgent(settings, { model: "sonnet" })).toEqual({ name: "claude", model: "sonnet" });
    });

    it("leaves the model to the agent when none is saved", () => {
      expect(chooseReviewAgent({ agent: "cursor", models: {} })).toEqual({ name: "cursor" });
    });
  });
});
