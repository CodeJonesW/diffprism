import { describe, it, expect } from "vitest";
import { dojoReport } from "@diffprism/core";
import type { DojoCombinedFinding, DojoState } from "@diffprism/core";
import { DOJO_EXIT, describeReport, exitCodeFor, parseAgents, parseFailOn } from "../commands/headless-dojo.js";

const finding = (over: Partial<DojoCombinedFinding> = {}): DojoCombinedFinding => ({
  id: "claude-1",
  raisedBy: "claude",
  file: "src/cache.ts",
  line: 12,
  side: "new",
  severity: "major",
  title: "Cache never expires",
  body: "Entries are written with no TTL.",
  votes: [],
  consensus: "agreed",
  ...over,
});

const state = (over: Partial<DojoState> = {}): DojoState => ({
  status: "done",
  agents: [{ agent: { name: "claude" }, label: "Claude Code", stage: "done", stageStartedAt: 1, raised: 1 }],
  findings: [],
  startedAt: 1,
  ...over,
});

describe("diffprism dojo (#301)", () => {
  describe("--agents", () => {
    it("is the configured default when not given", () => {
      expect(parseAgents(undefined)).toBeUndefined();
    });

    it("takes a comma-separated list", () => {
      expect(parseAgents("claude, cursor")).toEqual(["claude", "cursor"]);
    });

    it("refuses agents it doesn't know, and an empty list", () => {
      expect(() => parseAgents("claude,codex")).toThrow("not codex");
      expect(() => parseAgents(" , ")).toThrow("--agents takes");
    });
  });

  describe("--fail-on", () => {
    it("defaults to major", () => {
      expect(parseFailOn(undefined)).toBe("major");
    });

    it("refuses a severity that isn't one", () => {
      expect(() => parseFailOn("high")).toThrow("critical, major, minor, nit");
    });
  });

  describe("exit code", () => {
    it("is 0 when the dojo passed", () => {
      expect(exitCodeFor(dojoReport("s", state({ findings: [finding({ severity: "minor" })] }), "major"))).toBe(DOJO_EXIT.passed);
    });

    it("is 1 when it finished with a blocking finding", () => {
      expect(exitCodeFor(dojoReport("s", state({ findings: [finding()] }), "major"))).toBe(DOJO_EXIT.blocked);
    });

    it("is 2 when it didn't finish", () => {
      expect(exitCodeFor(dojoReport("s", state({ status: "failed", error: "boom" }), "major"))).toBe(DOJO_EXIT.unfinished);
      expect(exitCodeFor(dojoReport("s", state({ status: "stopped" }), "major"))).toBe(DOJO_EXIT.unfinished);
    });
  });

  describe("output", () => {
    it("lists each blocking finding with where it is and who raised it", () => {
      const text = describeReport(dojoReport("session-1", state({ findings: [finding(), finding({ id: "claude-2", severity: "nit" })] }), "major"));
      expect(text).toContain("Failed: 1 finding at major or above.");
      expect(text).toContain("[major] src/cache.ts:12  Cache never expires  (claude, agreed)");
      expect(text).toContain("  Entries are written with no TTL.");
      expect(text).toContain("1 more below major or disputed.");
      expect(text).toContain("Review session-1 is open in the dashboard");
    });

    it("says it passed, and how many findings there were", () => {
      const text = describeReport(dojoReport("session-1", state({ findings: [finding({ severity: "minor" })] }), "major"));
      expect(text).toContain("Passed: no findings at major or above. 1 finding in all.");
    });

    it("says why a dojo didn't finish", () => {
      expect(describeReport(dojoReport("session-1", state({ status: "failed", error: "claude exited 1" }), "major"))).toBe(
        "The dojo failed: claude exited 1",
      );
    });
  });
});
