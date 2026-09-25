import type { ReviewAgentChoice, ReviewAgentName } from "./agent-settings.js";
import type { DiffSide, GlobalServerInfo } from "./types.js";

// ─── The review dojo (#231) ───
//
// Several coding agents review the same pull request on their own, then each
// votes on what the others found. What comes back says, for every finding,
// who raised it, who agrees and who doesn't. Deciding that is plain
// arithmetic over the votes, done here, never by a model: a summary written
// by one of the agents could misreport the others.

export const DOJO_SEVERITIES = ["critical", "major", "minor", "nit"] as const;
export type DojoSeverity = (typeof DOJO_SEVERITIES)[number];

/** One issue an agent raised in its own review. */
export interface DojoFinding {
  file: string;
  line: number;
  side: DiffSide;
  severity: DojoSeverity;
  title: string;
  body: string;
}

/** One agent's verdict on another agent's finding. */
export interface DojoVote {
  agent: ReviewAgentName;
  stance: "agree" | "disagree";
  /** How much it matters, in this agent's view. */
  severity: DojoSeverity;
  note: string;
}

/**
 * - `agreed`: every other agent voted and agreed.
 * - `disputed`: at least one other agent disagreed.
 * - `partial`: nobody disagreed, but not every other agent voted.
 * - `solo`: only one agent reviewed, so nobody else could vote.
 */
export type DojoConsensus = "agreed" | "disputed" | "partial" | "solo";

export interface DojoCombinedFinding extends DojoFinding {
  /** Stable within one dojo: `<agent>-<n>`, e.g. `claude-2`. */
  id: string;
  raisedBy: ReviewAgentName;
  votes: DojoVote[];
  consensus: DojoConsensus;
  /** The review thread posted for it on its line, once there is one. */
  annotationId?: string;
}

/** How one agent's part in the dojo went. */
export interface DojoAgentOutcome {
  agent: ReviewAgentChoice;
  label: string;
  /** Why it dropped out, if it did. Its findings and votes are then missing. */
  error?: string;
}

export type DojoStatus = "running" | "done" | "failed";

/** A dojo on one review, as the dashboard shows it. */
export interface DojoState {
  status: DojoStatus;
  agents: DojoAgentOutcome[];
  findings: DojoCombinedFinding[];
  startedAt: number;
  finishedAt?: number;
  /** Why the whole dojo failed, when status is "failed". */
  error?: string;
}

/** An agent the dojo can seat: installed here, with the model it would use. */
export interface DojoAvailableAgent {
  name: ReviewAgentName;
  label: string;
  model?: string;
}

export interface DojoRequest {
  sessionId: string;
  prUrl: string;
  /** The local clone the review reads from, or null when there isn't one. */
  localRepoPath: string | null;
  server: GlobalServerInfo;
  agents: ReviewAgentChoice[];
}

export interface DojoResult {
  agents: DojoAgentOutcome[];
  findings: DojoCombinedFinding[];
}

/**
 * Runs dojos. The CLI supplies it, as it supplies the PR agent: core knows
 * nothing about Claude Code or Cursor.
 */
export interface DojoRunner {
  available(): Promise<DojoAvailableAgent[]>;
  /** Rejects only when no agent could take part at all. */
  run(request: DojoRequest): Promise<DojoResult>;
}

/** What each agent found in round one, by agent. */
export interface DojoRoundOne {
  agent: ReviewAgentName;
  findings: DojoFinding[];
}

/** One agent's votes in round two, keyed by finding id. */
export interface DojoRoundTwo {
  agent: ReviewAgentName;
  votes: Array<{ findingId: string } & Omit<DojoVote, "agent">>;
}

const SEVERITY_RANK: Record<DojoSeverity, number> = { critical: 0, major: 1, minor: 2, nit: 3 };
const CONSENSUS_RANK: Record<DojoConsensus, number> = { agreed: 0, disputed: 1, partial: 2, solo: 3 };

/** The id each finding gets: its agent and its place in that agent's list. */
export function dojoFindingId(agent: ReviewAgentName, index: number): string {
  return `${agent}-${index + 1}`;
}

/**
 * Put the two rounds together. `reviewers` are the agents whose round one
 * succeeded; a finding's consensus is judged against the others among them.
 * A vote on a finding that doesn't exist, or on the voter's own, is ignored.
 * Sorted by consensus, then by the most severe view anyone took.
 */
export function combineFindings(roundOne: DojoRoundOne[], roundTwo: DojoRoundTwo[]): DojoCombinedFinding[] {
  const reviewers = roundOne.map((r) => r.agent);
  const combined: DojoCombinedFinding[] = roundOne.flatMap(({ agent, findings }) =>
    findings.map((f, i) => ({ ...f, id: dojoFindingId(agent, i), raisedBy: agent, votes: [], consensus: "solo" as const })),
  );
  const byId = new Map(combined.map((f) => [f.id, f]));

  for (const { agent, votes } of roundTwo) {
    for (const { findingId, ...vote } of votes) {
      const finding = byId.get(findingId);
      if (!finding || finding.raisedBy === agent) continue;
      if (finding.votes.some((v) => v.agent === agent)) continue;
      finding.votes.push({ agent, ...vote });
    }
  }

  for (const finding of combined) {
    const others = reviewers.filter((a) => a !== finding.raisedBy);
    finding.consensus =
      others.length === 0
        ? "solo"
        : finding.votes.some((v) => v.stance === "disagree")
          ? "disputed"
          : finding.votes.length === others.length
            ? "agreed"
            : "partial";
  }

  const worst = (f: DojoCombinedFinding) =>
    Math.min(SEVERITY_RANK[f.severity], ...f.votes.map((v) => SEVERITY_RANK[v.severity]));
  return combined.sort(
    (a, b) => CONSENSUS_RANK[a.consensus] - CONSENSUS_RANK[b.consensus] || worst(a) - worst(b),
  );
}

const CONSENSUS_TEXT: Record<DojoConsensus, string> = {
  agreed: "Every agent agrees.",
  disputed: "Disputed.",
  partial: "Not every agent voted.",
  solo: "Only one agent reviewed.",
};

/**
 * The opening message of a finding's thread on its line: what was found, who
 * raised it, and where each other agent stands. `labels` names each agent the
 * way it signs its replies.
 */
export function dojoThreadBody(
  finding: DojoCombinedFinding,
  labels: Partial<Record<ReviewAgentName, string>>,
): string {
  const name = (agent: ReviewAgentName) => labels[agent] ?? agent;
  const lines = [
    `[${finding.severity}] ${finding.title}`,
    `Raised by ${name(finding.raisedBy)} in the review dojo. ${CONSENSUS_TEXT[finding.consensus]}`,
    "",
    finding.body,
  ];
  if (finding.votes.length > 0) {
    lines.push("");
    for (const vote of finding.votes) {
      const stance = vote.stance === "agree" ? "agrees" : "disagrees";
      lines.push(`${name(vote.agent)} ${stance} (${vote.severity})${vote.note ? `: ${vote.note}` : ""}`);
    }
  }
  return lines.join("\n");
}
