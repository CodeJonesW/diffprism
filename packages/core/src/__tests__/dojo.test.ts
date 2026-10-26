import { describe, it, expect } from "vitest";
import { blockingFindings, combineFindings, dojoReport } from "../dojo.js";
import type { DojoCombinedFinding, DojoFinding, DojoState } from "../dojo.js";

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

describe("a dojo's verdict, run headless (#301)", () => {
  const finding = (over: Partial<DojoCombinedFinding>): DojoCombinedFinding => ({
    id: "claude-1",
    raisedBy: "claude",
    file: "src/a.ts",
    line: 3,
    side: "new",
    severity: "major",
    title: "t",
    body: "b",
    votes: [],
    consensus: "agreed",
    ...over,
  });

  it("blocks on findings at or above the bar that nobody disputed", () => {
    const critical = finding({ id: "claude-1", severity: "critical" });
    const major = finding({ id: "claude-2", severity: "major", consensus: "partial" });
    const minor = finding({ id: "claude-3", severity: "minor" });
    const disputed = finding({ id: "cursor-1", severity: "critical", consensus: "disputed" });
    const solo = finding({ id: "claude-4", severity: "major", consensus: "solo" });
    expect(blockingFindings([critical, major, minor, disputed, solo], "major").map((f) => f.id)).toEqual([
      "claude-1",
      "claude-2",
      "claude-4",
    ]);
    expect(blockingFindings([critical, major, minor], "critical").map((f) => f.id)).toEqual(["claude-1"]);
    expect(blockingFindings([minor], "nit").map((f) => f.id)).toEqual(["claude-3"]);
  });

  const state = (over: Partial<DojoState>): DojoState => ({
    status: "done",
    agents: [{ agent: { name: "claude" }, label: "Claude Code", stage: "done", stageStartedAt: 1, raised: 1 }],
    findings: [],
    startedAt: 1,
    ...over,
  });

  it("passes a finished dojo with nothing blocking", () => {
    const report = dojoReport("session-1", state({ findings: [finding({ severity: "minor" })] }), "major");
    expect(report).toMatchObject({ status: "done", sessionId: "session-1", failOn: "major", passed: true, blocking: [] });
    expect(report.findings).toHaveLength(1);
    expect(report.agents).toEqual([{ name: "claude", label: "Claude Code", stage: "done", raised: 1 }]);
  });

  it("fails a finished dojo with a blocking finding", () => {
    const report = dojoReport("session-1", state({ findings: [finding({})] }), "major");
    expect(report.passed).toBe(false);
    expect(report.blocking).toHaveLength(1);
  });

  it("never passes a dojo that didn't finish, and says why", () => {
    const report = dojoReport("session-1", state({ status: "failed", error: "claude exited" }), "major");
    expect(report).toMatchObject({ passed: false, status: "failed", error: "claude exited" });
    expect(dojoReport("session-1", state({ status: "stopped" }), "major").passed).toBe(false);
  });
});
