import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { MCP_TOOL_NAMES, RETIRED_MCP_TOOL_NAMES, mcpToolPermission } from "@diffprism/core";
import { withoutRetiredHooks } from "../commands/setup.js";

/**
 * This repo commits its own Claude Code settings, so every clone and worktree
 * of DiffPrism starts from them. They are an install like any other, and they
 * went stale like one: until #215 they allowed the tools by their names from
 * before the rename, and kept a Stop hook for a command #139 had deleted.
 */
describe("the repo's own .claude/settings.json", () => {
  const settings = JSON.parse(
    fs.readFileSync(new URL("../../../.claude/settings.json", import.meta.url), "utf-8"),
  ) as Record<string, unknown>;
  const allow = ((settings.permissions as { allow?: string[] } | undefined)?.allow ?? []);

  it("allows every tool the MCP server registers", () => {
    for (const name of MCP_TOOL_NAMES) {
      expect(allow).toContain(mcpToolPermission(name));
    }
  });

  it("allows no tool that has been retired", () => {
    for (const name of RETIRED_MCP_TOOL_NAMES) {
      expect(allow).not.toContain(mcpToolPermission(name));
    }
  });

  it("has no hook that calls a retired DiffPrism command", () => {
    expect(withoutRetiredHooks(settings)).toBeNull();
  });
});
