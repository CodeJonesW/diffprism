import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AsyncQueue,
  DOJO_SEVERITIES,
  DojoStoppedError,
  combineFindings,
  diffNewSide,
  dojoFindingId,
  readAgentSettings,
  recordError,
} from "@diffprism/core";
import type {
  DiffSide,
  DojoAvailableAgent,
  DojoFinding,
  DojoRequest,
  DojoResult,
  DojoRoundOne,
  DojoRoundTwo,
  DojoRun,
  DojoRunner,
  DojoSeat,
  DojoSeverity,
  DojoSubject,
  ReviewAgentChoice,
  ReviewAgentName,
} from "@diffprism/core";
import { AGENT_KINDS, agentInstalled, runAgent, thisBuildsMcpServer } from "./pr-agent.js";
import type { AgentConversation, AgentKind, AgentProcess, AgentReview, AgentRunner, McpCommand } from "./pr-agent.js";

// ─── The review dojo (#231) ───
//
// Round one: every agent reviews the change on its own, in parallel.
// Round two: each one votes on what the others found. Both rounds are one
// turn of the same conversation, so a vote is cast by an agent that remembers
// its own review. Agents answer in JSON on their output; anything else is a
// failed turn that says so, never a guess at what the agent meant.

const MAX_FINDINGS = 15;

/** A local change, by the diff ref it's shown with. */
const LOCAL_CHANGE: Record<string, string> = {
  staged: "the staged changes — what the next commit will contain —",
  unstaged: "the unstaged changes",
  "working-copy": "the uncommitted changes",
};

/** What a dojo reviews, in words for a prompt: a PR's URL, or a local change and where it is (#238). */
export function describeSubject(subject: DojoSubject): string {
  if (subject.kind === "pr") return subject.url;
  return `${LOCAL_CHANGE[subject.diffRef] ?? `the diff ${subject.diffRef}`} in ${subject.repoPath}`;
}

export function dojoInstructions(request: Pick<DojoRequest, "sessionId" | "subject" | "localRepoPath">, label: string): string {
  const { subject } = request;
  const lines = [
    `You are ${label}, one of several AI code reviewers in a review dojo on ${describeSubject(subject)} (DiffPrism review ${request.sessionId}).`,
    `Read the change with the DiffPrism tools, passing session_id "${request.sessionId}": get_pr_context for what is under review and which files it touches, get_file_diff for each file's changes, get_file_context for surrounding code. The repository is at ${request.localRepoPath}; read the rest of it as you need to.`,
  ];
  // A commit is the index, not the files on disk (#238).
  if (subject.kind === "local" && diffNewSide(subject.diffRef).kind === "index") {
    lines.push(
      "Judge the staged version of each file, which get_file_diff and get_file_context show. The files on disk may hold edits this commit leaves out, so don't judge a changed file by reading it directly.",
    );
  }
  lines.push(
    "You can't change files, and don't reply to or annotate the review: the dojo posts the combined result itself.",
    "Answer every message with one ```json block and nothing after it. Nobody reads anything else you write.",
  );
  return lines.join("\n");
}

export function reviewPrompt(): string {
  return [
    "Round one: review this change on your own.",
    `Report up to ${MAX_FINDINGS} issues a careful reviewer would raise — bugs, security, data loss, missing handling, misleading code. Skip style preferences unless they cause harm. No issues is a fine answer.`,
    "Each finding is on a line of a file the change touches: `line` is the line number in the new file, or, for a removed line, in the old file with `side` \"old\".",
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
  now: () => number;
  /**
   * How long an agent may go without doing anything (no tool call, no
   * thinking, no output) before its turn is stopped and it drops out (#252).
   * A limit on silence, not on length: a long review that keeps working is
   * never cut off.
   */
  quietLimitMs: number;
  /**
   * The same, while a tool call is under way. A call sends nothing until it
   * returns, so a slow one would look like silence under the shorter limit;
   * this one still ends a call that has truly hung.
   */
  toolQuietLimitMs: number;
}

/** Five minutes without a sign of life: far past a slow model, well short of forever. */
const QUIET_LIMIT_MS = 5 * 60 * 1000;
/** A tool call gets three times as long before it counts as hung. */
const TOOL_QUIET_LIMIT_MS = 15 * 60 * 1000;

/** A dojo's stop switch, and the turns it has to end when thrown. */
interface DojoControl {
  stoppedBecause: string | null;
  turns: Set<AgentProcess>;
}

/** 90s, 5 minutes. */
function describeWait(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} minute${ms < 90_000 ? "" : "s"}`;
}

interface Seat {
  choice: ReviewAgentChoice;
  kind: AgentKind;
  review: AgentReview;
  /** What the dashboard shows for this agent; replaced whole on every change. */
  view: DojoSeat;
  conversation?: AgentConversation;
}

/**
 * Seat the chosen agents, run both rounds, and put the result together. Every
 * change to a seat — its stage, what it's reading, how many findings it raised
 * — goes out on `progress` as it happens. An agent that can't start, review or
 * vote, or goes quiet too long, drops out with the reason; the dojo fails only
 * when nobody reviewed. `stop` ends it at once (#252).
 */
export function runDojo(request: DojoRequest, deps: DojoDeps): DojoRun {
  const progress = new AsyncQueue<DojoSeat>();
  const control: DojoControl = { stoppedBecause: null, turns: new Set() };
  const result = play(request, deps, progress, control).finally(() => progress.end());
  return {
    progress,
    result,
    stop(reason) {
      if (control.stoppedBecause !== null) return;
      control.stoppedBecause = reason;
      for (const turn of control.turns) turn.kill();
    },
  };
}

async function play(
  request: DojoRequest,
  deps: DojoDeps,
  progress: AsyncQueue<DojoSeat>,
  control: DojoControl,
): Promise<DojoResult> {
  const stopIfAsked = () => {
    if (control.stoppedBecause !== null) throw new DojoStoppedError(control.stoppedBecause);
  };
  const update = (seat: Seat, change: Partial<DojoSeat>) => {
    const stage = change.stage && change.stage !== seat.view.stage ? { stageStartedAt: deps.now(), activity: undefined } : {};
    seat.view = { ...seat.view, ...stage, ...change };
    progress.push(seat.view);
  };
  const drop = (seat: Seat, stage: string, err: unknown) => {
    // Stopped isn't a failure of this agent's: the whole dojo is ending.
    if (err instanceof DojoStoppedError) {
      update(seat, { stage: "dropped", error: "stopped" });
      return;
    }
    recordError("dojo", err);
    const error = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
    update(seat, { stage: "dropped", error });
    deps.log(`${request.sessionId}: dojo — ${seat.kind.label} ${error}`);
  };
  /**
   * One turn, reporting each thing the agent does while it runs. A turn that
   * goes quiet past the limit is stopped, and so is every turn when the dojo is.
   */
  const turn = async (seat: Seat, first: boolean, prompt: string): Promise<string> => {
    stopIfAsked();
    const invocation = seat.kind.turn(seat.review, seat.conversation!, {
      first,
      prompt,
      instructions: dojoInstructions(request, seat.kind.label),
    });
    const running = deps.run(seat.kind.command, invocation, seat.conversation!.cwd);
    control.turns.add(running);
    let wentQuietAfter: number | null = null;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let toolsUnderWay = 0;
    const listen = () => {
      clearTimeout(quiet);
      const limit = toolsUnderWay > 0 ? deps.toolQuietLimitMs : deps.quietLimitMs;
      quiet = setTimeout(() => {
        wentQuietAfter = limit;
        running.kill();
      }, limit);
    };
    try {
      listen();
      for await (const event of running.events) {
        toolsUnderWay = Math.max(0, toolsUnderWay + seat.kind.toolCalls(event));
        listen();
        const activity = seat.kind.describe(event, seat.review);
        // Thinking streams in many pieces; one report of it is enough.
        if (activity && activity !== seat.view.activity) update(seat, { activity });
      }
      const { code, output } = await running.done;
      stopIfAsked();
      if (wentQuietAfter !== null) throw new Error(`went quiet: nothing for ${describeWait(wentQuietAfter)}, so it was stopped.`);
      if (code !== 0) throw new Error(`exited with status ${code}:\n${output.trim()}`);
      return output;
    } finally {
      clearTimeout(quiet);
      control.turns.delete(running);
    }
  };

  const seats: Seat[] = request.agents.map((choice) => {
    const kind = deps.kinds[choice.name];
    return {
      choice,
      kind,
      view: { agent: choice, label: kind.label, stage: "starting", stageStartedAt: deps.now() },
      review: {
        reviewSessionId: request.sessionId,
        subject: describeSubject(request.subject),
        localRepoPath: request.localRepoPath,
        model: choice.model,
        mcp: deps.mcp,
        folder: () => deps.folder(request.sessionId, choice.name),
        canEdit: false,
      },
    };
  });
  for (const seat of seats) progress.push(seat.view);

  // Round one: seat everyone who can start, and have them review.
  const roundOne: DojoRoundOne[] = [];
  await Promise.all(
    seats.map(async (seat) => {
      try {
        if (!(await deps.installed(seat.kind))) throw new Error(`isn't installed (${seat.kind.installHint}).`);
        seat.conversation = await seat.kind.begin(seat.review);
      } catch (err) {
        return drop(seat, "couldn't start", err);
      }
      try {
        update(seat, { stage: "reviewing" });
        const reviewStart = deps.now();
        const findings = parseFindings(await turn(seat, true, reviewPrompt()));
        roundOne.push({ agent: seat.choice.name, findings });
        // Its votes are on the others' findings, so it waits for theirs (#251).
        // Its own time is fixed now, whatever the others take (#272).
        update(seat, { stage: "waiting", raised: findings.length, reviewedInMs: deps.now() - reviewStart });
      } catch (err) {
        drop(seat, "couldn't review", err);
      }
    }),
  );
  stopIfAsked();
  if (roundOne.length === 0) {
    throw new Error(`No agent could review. ${seats.map((s) => `${s.kind.label} ${s.view.error}`).join(" ")}`);
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
        if (others.length === 0) return update(seat, { stage: "done" });
        try {
          update(seat, { stage: "voting" });
          const voteStart = deps.now();
          roundTwo.push({ agent: seat.choice.name, votes: parseVotes(await turn(seat, false, votePrompt(others))) });
          update(seat, { stage: "done", votedInMs: deps.now() - voteStart });
        } catch (err) {
          drop(seat, "couldn't vote", err);
        }
      }),
  );
  stopIfAsked();

  return { agents: seats.map((s) => s.view), findings: combineFindings(roundOne, roundTwo) };
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
    now: () => Date.now(),
    quietLimitMs: QUIET_LIMIT_MS,
    toolQuietLimitMs: TOOL_QUIET_LIMIT_MS,
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
