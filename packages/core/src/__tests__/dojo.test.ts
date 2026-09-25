import { describe, it, expect } from "vitest";
import { combineFindings } from "../dojo.js";
import type { DojoFinding } from "../dojo.js";

function finding(title: string, severity: DojoFinding["severity"] = "minor"): DojoFinding {
  return { file: "src/a.ts", line: 3, side: "new", severity, title, body: `${title} body` };
}

describe("combineFindings (#231)", () => {
  it("marks a finding every other agent agreed with as agreed", () => {
    const [f] = combineFindings(
      [
        { agent: "claude", findings: [finding("null deref")] },
        { agent: "cursor", findings: [] },
      ],
      [{ agent: "cursor", votes: [{ findingId: "claude-1", stance: "agree", severity: "major", note: "yes" }] }],
    );

    expect(f).toMatchObject({ id: "claude-1", raisedBy: "claude", consensus: "agreed" });
    expect(f.votes).toEqual([{ agent: "cursor", stance: "agree", severity: "major", note: "yes" }]);
  });

  it("marks a finding anyone disagreed with as disputed", () => {
    const [f] = combineFindings(
      [
        { agent: "claude", findings: [finding("style")] },
        { agent: "cursor", findings: [] },
      ],
      [{ agent: "cursor", votes: [{ findingId: "claude-1", stance: "disagree", severity: "nit", note: "fine as is" }] }],
    );
    expect(f.consensus).toBe("disputed");
  });

  it("calls a finding nobody voted on partial, not agreed", () => {
    const [f] = combineFindings(
      [
        { agent: "claude", findings: [finding("x")] },
        { agent: "cursor", findings: [] },
      ],
      [],
    );
    expect(f.consensus).toBe("partial");
  });

  it("calls every finding solo when only one agent reviewed", () => {
    const findings = combineFindings([{ agent: "claude", findings: [finding("a"), finding("b")] }], []);
    expect(findings.map((f) => f.consensus)).toEqual(["solo", "solo"]);
  });

  it("ignores votes on unknown findings, on the voter's own, and repeats", () => {
    const [f] = combineFindings(
      [
        { agent: "claude", findings: [finding("x")] },
        { agent: "cursor", findings: [] },
      ],
      [
        { agent: "claude", votes: [{ findingId: "claude-1", stance: "agree", severity: "minor", note: "mine" }] },
        {
          agent: "cursor",
          votes: [
            { findingId: "cursor-9", stance: "agree", severity: "minor", note: "?" },
            { findingId: "claude-1", stance: "agree", severity: "minor", note: "first" },
            { findingId: "claude-1", stance: "disagree", severity: "nit", note: "second" },
          ],
        },
      ],
    );
    expect(f.votes).toEqual([{ agent: "cursor", stance: "agree", severity: "minor", note: "first" }]);
    expect(f.consensus).toBe("agreed");
  });

  it("puts agreement first, then the most severe view anyone took", () => {
    const findings = combineFindings(
      [
        { agent: "claude", findings: [finding("minor agreed"), finding("nit raised, critical to cursor", "nit")] },
        { agent: "cursor", findings: [finding("disputed", "critical")] },
      ],
      [
        {
          agent: "cursor",
          votes: [
            { findingId: "claude-1", stance: "agree", severity: "minor", note: "" },
            { findingId: "claude-2", stance: "agree", severity: "critical", note: "" },
          ],
        },
        { agent: "claude", votes: [{ findingId: "cursor-1", stance: "disagree", severity: "nit", note: "" }] },
      ],
    );
    expect(findings.map((f) => f.title)).toEqual(["nit raised, critical to cursor", "minor agreed", "disputed"]);
  });
});
