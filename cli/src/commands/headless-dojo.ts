import {
  DEFAULT_DIFF_REF,
  DOJO_SEVERITIES,
  REPORT_HINT,
  REVIEW_AGENTS,
  dojoReport,
  ensureServer,
  isDojoSeverity,
  isReviewAgent,
  openHeadlessDojo,
  recordError,
  stopDojoOnServer,
  waitForDojo,
} from "@diffprism/core";
import type { DojoCombinedFinding, DojoReport, DojoSeverity, DojoState, ReviewAgentName } from "@diffprism/core";

export interface HeadlessDojoFlags {
  staged?: boolean;
  unstaged?: boolean;
  /** Comma-separated agents, e.g. "claude,cursor". Default: the configured agent. */
  agents?: string;
  failOn?: string;
  json?: boolean;
  /** Minutes to wait before stopping the dojo. */
  timeout?: string;
}

/** `diffprism dojo` exit codes (#301). */
export const DOJO_EXIT = {
  /** It finished with nothing at or above --fail-on, or there was nothing to review. */
  passed: 0,
  /** It finished with findings at or above --fail-on. */
  blocked: 1,
  /** It couldn't start, failed, or was stopped, including by --timeout. */
  unfinished: 2,
} as const;

export const DEFAULT_FAIL_ON: DojoSeverity = "major";
const DEFAULT_TIMEOUT_MINUTES = 30;

/** The agents named on the command line, or undefined for the configured default. */
export function parseAgents(list: string | undefined): ReviewAgentName[] | undefined {
  if (list === undefined) return undefined;
  const names = list.split(",").map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !isReviewAgent(name));
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(`--agents takes a comma-separated list of ${REVIEW_AGENTS.join(", ")}${unknown.length ? `; not ${unknown.join(", ")}` : ""}.`);
  }
  return names as ReviewAgentName[];
}

export function parseFailOn(value: string | undefined): DojoSeverity {
  if (value === undefined) return DEFAULT_FAIL_ON;
  if (!isDojoSeverity(value)) throw new Error(`--fail-on takes one of ${DOJO_SEVERITIES.join(", ")}.`);
  return value;
}

export function exitCodeFor(report: DojoReport): number {
  if (report.status !== "done") return DOJO_EXIT.unfinished;
  return report.passed ? DOJO_EXIT.passed : DOJO_EXIT.blocked;
}

/**
 * Run a review dojo on local changes with no dashboard (#301): open a
 * review no tab opens for, start the dojo, wait, and print what it found.
 * Progress goes to stderr; the result goes to stdout, as JSON with --json.
 */
export async function headlessDojo(ref: string | undefined, flags: HeadlessDojoFlags): Promise<void> {
  const diffRef = flags.staged ? "staged" : flags.unstaged ? "unstaged" : (ref ?? DEFAULT_DIFF_REF);

  let agents: ReviewAgentName[] | undefined;
  let failOn: DojoSeverity;
  let timeoutMs: number;
  try {
    agents = parseAgents(flags.agents);
    failOn = parseFailOn(flags.failOn);
    const minutes = flags.timeout === undefined ? DEFAULT_TIMEOUT_MINUTES : Number(flags.timeout);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--timeout takes a number of minutes above 0.");
    timeoutMs = minutes * 60_000;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = DOJO_EXIT.unfinished;
    return;
  }

  try {
    const server = await ensureServer({ silent: flags.json });
    const started = await openHeadlessDojo(server, diffRef, { cwd: process.cwd(), agents, title: `Dojo: ${diffRef}` });
    if (started.kind === "no_changes") {
      if (flags.json) console.log(JSON.stringify({ status: "no_changes", passed: true }, null, 2));
      else console.log(`No changes in ${diffRef} to review.`);
      process.exitCode = DOJO_EXIT.passed;
      return;
    }

    const { sessionId } = started;
    console.error(`Dojo started on review ${sessionId} (${diffRef}). Watch it with \`diffprism server status\` and the dashboard, or wait here.`);
    const seen = new Map<string, string>();
    let dojo = await waitForDojo(server, sessionId, timeoutMs, { onUpdate: (state) => printProgress(state, seen) });
    if (dojo.status === "running") {
      await stopDojoOnServer(server, sessionId);
      dojo = await waitForDojo(server, sessionId, 0);
      console.error(`No result after ${timeoutMs / 60_000} minutes, so the dojo was stopped.`);
    }

    const report = dojoReport(sessionId, dojo, failOn);
    console.log(flags.json ? JSON.stringify(report, null, 2) : describeReport(report));
    process.exitCode = exitCodeFor(report);
  } catch (err) {
    recordError("dojo", err);
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}\n${REPORT_HINT}`);
    process.exitCode = DOJO_EXIT.unfinished;
  }
}

/** One stderr line each time an agent moves to a new stage. */
function printProgress(dojo: DojoState, seen: Map<string, string>): void {
  for (const seat of dojo.agents) {
    if (seen.get(seat.agent.name) === seat.stage) continue;
    seen.set(seat.agent.name, seat.stage);
    const detail = seat.error ? `: ${seat.error}` : seat.raised !== undefined && seat.stage !== "reviewing" ? ` (${seat.raised} raised)` : "";
    console.error(`  ${seat.label}: ${seat.stage}${detail}`);
  }
}

export function describeReport(report: DojoReport): string {
  if (report.status !== "done") {
    return `The dojo ${report.status === "failed" ? "failed" : "was stopped"}${report.error ? `: ${report.error}` : "."}`;
  }
  const lines = [
    report.passed
      ? `Passed: no findings at ${report.failOn} or above. ${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} in all.`
      : `Failed: ${report.blocking.length} finding${report.blocking.length === 1 ? "" : "s"} at ${report.failOn} or above.`,
  ];
  for (const finding of report.blocking) lines.push("", describeFinding(finding));
  const others = report.findings.length - report.blocking.length;
  if (!report.passed && others > 0) lines.push("", `${others} more below ${report.failOn} or disputed. --json lists them all.`);
  lines.push("", `Review ${report.sessionId} is open in the dashboard with each finding as a thread.`);
  return lines.join("\n");
}

function describeFinding(finding: DojoCombinedFinding): string {
  return [
    `[${finding.severity}] ${finding.file}:${finding.line}  ${finding.title}  (${finding.raisedBy}, ${finding.consensus})`,
    ...finding.body.split("\n").map((line) => `  ${line}`),
  ].join("\n");
}
