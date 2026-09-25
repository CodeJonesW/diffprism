import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DOJO_SEVERITIES,
  combineFindings,
  dojoFindingId,
  readAgentSettings,
  recordError,
} from "@diffprism/core";
import type {
  DiffSide,
  DojoAgentOutcome,
  DojoAvailableAgent,
  DojoFinding,
  DojoRequest,
  DojoResult,
  DojoRoundOne,
  DojoRoundTwo,
  DojoRunner,
  DojoSeverity,
  ReviewAgentChoice,
  ReviewAgentName,
} from "@diffprism/core";
import { AGENT_KINDS, agentInstalled, runAgent, thisBuildsMcpServer } from "./pr-agent.js";
import type { AgentConversation, AgentKind, AgentReview, AgentRunner, McpCommand } from "./pr-agent.js";

// ─── The review dojo (#231) ───
//
// Round one: every agent reviews the pull request on its own, in parallel.
// Round two: each one votes on what the others found. Both rounds are one
// turn of the same conversation, so a vote is cast by an agent that remembers
// its own review. Agents answer in JSON on their output; anything else is a
// failed turn that says so, never a guess at what the agent meant.

const MAX_FINDINGS = 15;

export function dojoInstructions(request: Pick<DojoRequest, "sessionId" | "prUrl">, label: string): string {
  return [
    `You are ${label}, one of several AI code reviewers in a review dojo on ${request.prUrl} (DiffPrism review ${request.sessionId}).`,
    `Read the change with the DiffPrism tools, passing session_id "${request.sessionId}": get_pr_context for what the PR is and which files it touches, get_file_diff for each file's changes, get_file_context for surrounding code. Read the rest of the repository as you need to.`,
    "You can't change files, and don't reply to or annotate the review: the dojo posts the combined result itself.",
    "Answer every message with one ```json block and nothing after it. Nobody reads anything else you write.",
  ].join("\n");
}

export function reviewPrompt(): string {
  return [
    "Round one: review this pull request on your own.",
    `Report up to ${MAX_FINDINGS} issues a careful reviewer would raise — bugs, security, data loss, missing handling, misleading code. Skip style preferences unless they cause harm. No issues is a fine answer.`,
    "Each finding is on a line of a file the PR changes: `line` is the line number in the new file, or, for a removed line, in the old file with `side` \"old\".",
    `\`severity\` is one of ${DOJO_SEVERITIES.join(", ")}.`,
    "```json",
    '{"findings": [{"file": "src/a.ts", "line": 12, "side": "new", "severity": "major", "title": "Short name of the issue", "body": "What is wrong, why it matters, what to do."}]}',
    "```",
  ].join("\n");
}

export function votePrompt(others: Array<{ id: string; label: string; finding: DojoFinding }>): string {
  const listed = others.map(
    ({ id, label, finding: f }) =>
      `${id} — from ${label} — ${f.file}:${f.line}${f.side === "old" ? " (removed line)" : ""} [${f.severity}] ${f.title}\n  ${f.body}`,
  );
  return [
    "Round two: the other reviewers found these. Check each against the code and vote.",
    "",
    ...listed,
    "",
    "`stance` is agree or disagree that it is a real problem worth raising. `severity` is how much it matters in your view. `note` is one sentence on why — say so if it duplicates one of your own findings.",
    "```json",
    '{"votes": [{"findingId": "claude-1", "stance": "agree", "severity": "major", "note": "Why, in one sentence."}]}',
    "```",
  ].join("\n");
}

// ─── Reading what an agent said ───

/** The last ```json block in an agent's output, parsed. Throws with the output when there isn't a valid one. */
export function lastJsonBlock(output: string): unknown {
  const blocks = [...output.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const text = blocks.at(-1) ?? output.trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`didn't answer with a JSON block. Its output ended:\n${output.trim().slice(-500) || "(nothing)"}`);
  }
}

const isSeverity = (v: unknown): v is DojoSeverity => typeof v === "string" && (DOJO_SEVERITIES as readonly string[]).includes(v);

export function parseFindings(output: string): DojoFinding[] {
  const value = lastJsonBlock(output) as { findings?: unknown };
  if (!Array.isArray(value?.findings)) throw new Error("answered without a findings list.");
  return value.findings.slice(0, MAX_FINDINGS).map((raw, i) => {
    const f = raw as Record<string, unknown>;
    const side: DiffSide = f.side === "old" ? "old" : "new";
    if (typeof f.file !== "string" || !f.file) throw new Error(`finding ${i + 1} has no file.`);
    if (!Number.isInteger(f.line) || (f.line as number) < 1) throw new Error(`finding ${i + 1} has no line number.`);
    if (!isSeverity(f.severity)) throw new Error(`finding ${i + 1} has severity "${String(f.severity)}".`);
    if (typeof f.title !== "string" || !f.title.trim()) throw new Error(`finding ${i + 1} has no title.`);
    return { file: f.file, line: f.line as number, side, severity: f.severity, title: f.title.trim(), body: String(f.body ?? "").trim() };
  });
}

export function parseVotes(output: string): DojoRoundTwo["votes"] {
  const value = lastJsonBlock(output) as { votes?: unknown };
  if (!Array.isArray(value?.votes)) throw new Error("answered without a votes list.");
  return value.votes.map((raw, i) => {
    const v = raw as Record<string, unknown>;
    if (typeof v.findingId !== "string") throw new Error(`vote ${i + 1} names no finding.`);
    if (v.stance !== "agree" && v.stance !== "disagree") throw new Error(`vote ${i + 1} has stance "${String(v.stance)}".`);
    if (!isSeverity(v.severity)) throw new Error(`vote ${i + 1} has severity "${String(v.severity)}".`);
    return { findingId: v.findingId, stance: v.stance, severity: v.severity, note: String(v.note ?? "").trim() };
  });
}

// ─── Running a dojo ───

/** A folder of each agent's own for one dojo, apart from the review's answering agent. */
function dojoFolder(sessionId: string, agent: ReviewAgentName): string {
  const dir = path.join(os.tmpdir(), "diffprism-agent", sessionId, `dojo-${agent}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface DojoDeps {
  kinds: Record<ReviewAgentName, AgentKind>;
  installed: (kind: AgentKind) => Promise<boolean>;
  run: AgentRunner;
  mcp: McpCommand;
  folder: (sessionId: string, agent: ReviewAgentName) => string;
  log: (line: string) => void;
}

interface Seat {
  choice: ReviewAgentChoice;
  kind: AgentKind;
  review: AgentReview;
  outcome: DojoAgentOutcome;
  conversation?: AgentConversation;
}

async function turn(seat: Seat, deps: DojoDeps, request: DojoRequest, first: boolean, prompt: string): Promise<string> {
  const invocation = seat.kind.turn(seat.review, seat.conversation!, {
    first,
    prompt,
    instructions: dojoInstructions(request, seat.kind.label),
  });
  const { code, output } = await deps.run(seat.kind.command, invocation, seat.conversation!.cwd);
  if (code !== 0) throw new Error(`exited with status ${code}:\n${output.trim()}`);
  return output;
}

function drop(seat: Seat, stage: string, err: unknown, deps: DojoDeps, request: DojoRequest): void {
  recordError("dojo", err);
  seat.outcome.error = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
  deps.log(`${request.sessionId}: dojo — ${seat.kind.label} ${seat.outcome.error}`);
}

/**
 * Seat the chosen agents, run both rounds, and put the result together. An
 * agent that can't start, review or vote drops out with the reason recorded;
 * the dojo fails only when no agent reviewed at all.
 */
export async function runDojo(request: DojoRequest, deps: DojoDeps): Promise<DojoResult> {
  const seats: Seat[] = request.agents.map((choice) => {
    const kind = deps.kinds[choice.name];
    return {
      choice,
      kind,
      outcome: { agent: choice, label: kind.label },
      review: {
        reviewSessionId: request.sessionId,
        prUrl: request.prUrl,
        localRepoPath: request.localRepoPath,
        model: choice.model,
        mcp: deps.mcp,
        folder: () => deps.folder(request.sessionId, choice.name),
      },
    };
  });

  // Round one: seat everyone who can start, and have them review.
  const roundOne: DojoRoundOne[] = [];
  await Promise.all(
    seats.map(async (seat) => {
      try {
        if (!(await deps.installed(seat.kind))) throw new Error(`isn't installed (${seat.kind.installHint}).`);
        seat.conversation = await seat.kind.begin(seat.review);
      } catch (err) {
        return drop(seat, "couldn't start", err, deps, request);
      }
      try {
        deps.log(`${request.sessionId}: dojo — ${seat.kind.label} is reviewing.`);
        const findings = parseFindings(await turn(seat, deps, request, true, reviewPrompt()));
        roundOne.push({ agent: seat.choice.name, findings });
      } catch (err) {
        drop(seat, "couldn't review", err, deps, request);
      }
    }),
  );
  if (roundOne.length === 0) {
    throw new Error(`No agent could review. ${seats.map((s) => `${s.kind.label} ${s.outcome.error}`).join(" ")}`);
  }
  // Keep the order agents were chosen in, whichever finished first.
  roundOne.sort((a, b) => request.agents.findIndex((c) => c.name === a.agent) - request.agents.findIndex((c) => c.name === b.agent));

  // Round two: each reviewer votes on everyone else's findings.
  const labels = Object.fromEntries(seats.map((s) => [s.choice.name, s.kind.label]));
  const roundTwo: DojoRoundTwo[] = [];
  await Promise.all(
    seats
      .filter((seat) => roundOne.some((r) => r.agent === seat.choice.name))
      .map(async (seat) => {
        const others = roundOne
          .filter((r) => r.agent !== seat.choice.name)
          .flatMap((r) => r.findings.map((finding, i) => ({ id: dojoFindingId(r.agent, i), label: labels[r.agent], finding })));
        if (others.length === 0) return;
        try {
          deps.log(`${request.sessionId}: dojo — ${seat.kind.label} is voting.`);
          roundTwo.push({ agent: seat.choice.name, votes: parseVotes(await turn(seat, deps, request, false, votePrompt(others))) });
        } catch (err) {
          drop(seat, "couldn't vote", err, deps, request);
        }
      }),
  );

  return { agents: seats.map((s) => s.outcome), findings: combineFindings(roundOne, roundTwo) };
}

/** The server's dojo runner (#231): the installed agents, run as `runDojo` says. */
export function dojoRunner(deps: Partial<DojoDeps> = {}): DojoRunner {
  const full: DojoDeps = {
    kinds: AGENT_KINDS,
    installed: agentInstalled,
    run: runAgent,
    mcp: thisBuildsMcpServer(),
    folder: dojoFolder,
    log: (line) => console.log(line),
    ...deps,
  };

  return {
    async available(): Promise<DojoAvailableAgent[]> {
      const { models } = readAgentSettings();
      const kinds = Object.values(full.kinds);
      const installed = await Promise.all(kinds.map((kind) => full.installed(kind)));
      return kinds
        .filter((_, i) => installed[i])
        .map((kind) => (models[kind.name] ? { name: kind.name, label: kind.label, model: models[kind.name] } : { name: kind.name, label: kind.label }));
    },
    run: (request) => runDojo(request, full),
  };
}
