import { useEffect, useState } from "react";
import { Swords, Loader2, Check, X, PanelRightClose, AlertTriangle, CircleCheck, CircleX } from "lucide-react";
import type {
  DojoAvailableAgent,
  DojoCombinedFinding,
  DojoConsensus,
  DojoSeat,
  DojoSeverity,
  DojoState,
  ReviewAgentName,
} from "../../types";
import { useHttpApi } from "../../hooks/useHttpApi";

const GROUPS: Array<{ consensus: DojoConsensus; title: string; hint: string }> = [
  { consensus: "agreed", title: "Agreed", hint: "Every agent agrees this is a problem." },
  { consensus: "disputed", title: "Disputed", hint: "At least one agent disagrees." },
  { consensus: "partial", title: "Not every agent voted", hint: "Nobody disagreed, but not everyone voted." },
  { consensus: "solo", title: "One reviewer", hint: "Only one agent reviewed." },
];

const SEVERITY_STYLE: Record<DojoSeverity, string> = {
  critical: "bg-danger/15 text-danger border-danger/30",
  major: "bg-warning/15 text-warning border-warning/30",
  minor: "bg-info/15 text-info border-info/30",
  nit: "bg-neutral/15 text-text-secondary border-border",
};

interface DojoPanelProps {
  sessionId: string;
  dojo: DojoState | null;
  /** Go to the finding's thread on its line. */
  onNavigate: (finding: DojoCombinedFinding) => void;
  onHide: () => void;
}

/**
 * The review dojo (#231): pick the agents, they review the PR on their own and
 * vote on each other's findings, and this shows where they agree and where
 * they don't. Each finding is also a thread on its line.
 */
export function DojoPanel({ sessionId, dojo, onNavigate, onHide }: DojoPanelProps) {
  const [choosing, setChoosing] = useState(false);
  // A failed dojo offers to run again, with why the last one failed.
  const showPicker = !dojo || choosing || dojo.status === "failed";

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <Swords className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex-1">Review dojo</span>
        <button
          onClick={onHide}
          className="p-1 rounded hover:bg-border/50 text-text-secondary hover:text-text-primary transition-colors"
          title="Hide the dojo"
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {showPicker ? (
          <AgentPicker
            sessionId={sessionId}
            error={dojo?.status === "failed" ? dojo.error : undefined}
            onStarted={() => setChoosing(false)}
            onCancel={dojo ? () => setChoosing(false) : undefined}
          />
        ) : dojo.status === "running" ? (
          <Running dojo={dojo} />
        ) : (
          <Results dojo={dojo} onNavigate={onNavigate} onRunAgain={() => setChoosing(true)} />
        )}
      </div>
    </div>
  );
}

function AgentPicker({
  sessionId,
  error,
  onStarted,
  onCancel,
}: {
  sessionId: string;
  error?: string;
  onStarted: () => void;
  onCancel?: () => void;
}) {
  const { getDojoAgents, startDojo } = useHttpApi();
  const [agents, setAgents] = useState<DojoAvailableAgent[] | null>(null);
  const [chosen, setChosen] = useState<Set<ReviewAgentName>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getDojoAgents().then((result) => {
      if (result.ok) {
        setAgents(result.agents);
        setChosen(new Set(result.agents.map((a) => a.name)));
      } else {
        setProblem(result.error);
      }
    });
  }, [getDojoAgents]);

  async function start() {
    setStarting(true);
    setProblem(null);
    const result = await startDojo(sessionId, [...chosen]);
    setStarting(false);
    if (result.ok) onStarted();
    else setProblem(result.error ?? "The dojo didn't start.");
  }

  const toggle = (name: ReviewAgentName) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        Each agent reviews this pull request on its own, then votes on what the others found. You get one list, with who
        agrees and who doesn't.
      </p>
      {error && <p className="text-xs text-danger">The last dojo failed: {error}</p>}
      {agents === null && !problem && <p className="text-xs text-text-secondary">Finding your agents…</p>}
      {agents?.length === 0 && (
        <p className="text-xs text-text-secondary">
          No agents are installed. The dojo seats Claude Code (<code className="text-accent">claude</code>) and Cursor
          (<code className="text-accent">cursor-agent</code>).
        </p>
      )}
      {agents && agents.length > 0 && (
        <ul className="space-y-1.5">
          {agents.map((agent) => (
            <li key={agent.name}>
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input type="checkbox" checked={chosen.has(agent.name)} onChange={() => toggle(agent.name)} />
                {agent.label}
                {agent.model && <span className="text-xs text-text-secondary">{agent.model}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {agents && chosen.size === 1 && (
        <p className="text-xs text-text-secondary">With one agent there is nobody to vote — you get its review alone.</p>
      )}
      {problem && <p className="text-xs text-danger">{problem}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={start}
          disabled={starting || chosen.size === 0}
          className="flex items-center gap-1.5 bg-accent/15 text-accent text-xs font-medium rounded-md px-3 py-2 hover:bg-accent/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Swords className="w-3.5 h-3.5" />}
          Start the dojo
        </button>
        {onCancel && (
          <button onClick={onCancel} className="text-xs text-text-secondary hover:text-text-primary">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** The current time, ticking every second while mounted — for the timers. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** 0:07, 2:13, 1:02:30. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const STAGE_TEXT: Record<DojoSeat["stage"], string> = {
  starting: "Starting",
  reviewing: "Reviewing",
  voting: "Voting on the others' findings",
  done: "Done",
  dropped: "Dropped out",
};

function Running({ dojo }: { dojo: DojoState }) {
  const now = useNow();
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        Each agent reviews on its own, then votes on the others' findings. Running for{" "}
        <span className="font-mono text-text-primary">{formatElapsed(now - dojo.startedAt)}</span>.
      </p>
      {dojo.agents.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-text-secondary">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          Starting the agents…
        </p>
      ) : (
        <ul className="space-y-2">
          {dojo.agents.map((seat) => (
            <li key={seat.agent.name}>
              <SeatRow seat={seat} now={now} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeatRow({ seat, now }: { seat: DojoSeat; now: number }) {
  const active = seat.stage === "starting" || seat.stage === "reviewing" || seat.stage === "voting";
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2" aria-label={seat.label}>
      <div className="flex items-center gap-2">
        {active ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent flex-shrink-0" />
        ) : seat.stage === "done" ? (
          <CircleCheck className="w-3.5 h-3.5 text-success flex-shrink-0" />
        ) : (
          <CircleX className="w-3.5 h-3.5 text-danger flex-shrink-0" />
        )}
        <span className="text-sm text-text-primary font-medium flex-1">{seat.label}</span>
        {active && <span className="text-xs font-mono text-text-secondary">{formatElapsed(now - seat.stageStartedAt)}</span>}
      </div>
      <p className="mt-1 text-xs text-text-secondary">
        {STAGE_TEXT[seat.stage]}
        {seat.raised !== undefined && ` · raised ${seat.raised}`}
      </p>
      {active && seat.activity && <p className="mt-0.5 text-xs text-text-primary font-mono truncate">{seat.activity}</p>}
      {seat.error && <p className="mt-0.5 text-xs text-danger">{seat.error}</p>}
    </div>
  );
}

function Results({
  dojo,
  onNavigate,
  onRunAgain,
}: {
  dojo: DojoState;
  onNavigate: (finding: DojoCombinedFinding) => void;
  onRunAgain: () => void;
}) {
  const labels = Object.fromEntries(dojo.agents.map((a) => [a.agent.name, a.label])) as Record<ReviewAgentName, string>;
  const dropped = dojo.agents.filter((a) => a.error);

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">
          {dojo.findings.length === 0
            ? `${dojo.agents.map((a) => a.label).join(" and ")} found nothing to raise.`
            : `${dojo.findings.length} finding${dojo.findings.length === 1 ? "" : "s"} from ${dojo.agents.map((a) => a.label).join(" and ")}.`}
        </p>
        <button onClick={onRunAgain} className="text-xs text-accent hover:underline">
          Run again
        </button>
      </div>
      {dropped.map((a) => (
        <p key={a.agent.name} className="flex gap-1.5 text-xs text-warning">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {a.label} {a.error}
          </span>
        </p>
      ))}
      {GROUPS.map(({ consensus, title, hint }) => {
        const findings = dojo.findings.filter((f) => f.consensus === consensus);
        if (findings.length === 0) return null;
        return (
          <section key={consensus} aria-label={title}>
            <h3 className="text-xs font-semibold text-text-primary" title={hint}>
              {title} ({findings.length})
            </h3>
            <ul className="mt-1.5 space-y-2">
              {findings.map((f) => (
                <li key={f.id}>
                  <FindingCard finding={f} labels={labels} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function FindingCard({
  finding,
  labels,
  onNavigate,
}: {
  finding: DojoCombinedFinding;
  labels: Record<ReviewAgentName, string>;
  onNavigate: (finding: DojoCombinedFinding) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(finding)}
      className="w-full text-left rounded-md border border-border bg-background px-3 py-2 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span className={`text-[11px] font-medium rounded border px-1.5 py-0.5 ${SEVERITY_STYLE[finding.severity]}`}>
          {finding.severity}
        </span>
        <span className="text-sm text-text-primary font-medium">{finding.title}</span>
      </div>
      <p className="mt-1 text-xs text-text-secondary font-mono truncate">
        {finding.file}:{finding.line}
      </p>
      {finding.body && <p className="mt-1 text-xs text-text-primary whitespace-pre-wrap">{finding.body}</p>}
      <ul className="mt-2 space-y-1 text-xs">
        <li className="text-text-secondary">Raised by {labels[finding.raisedBy] ?? finding.raisedBy}</li>
        {finding.votes.map((vote) => (
          <li key={vote.agent} className="flex gap-1.5">
            {vote.stance === "agree" ? (
              <Check className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" aria-label="agrees" />
            ) : (
              <X className="w-3.5 h-3.5 text-danger flex-shrink-0 mt-0.5" aria-label="disagrees" />
            )}
            <span className="text-text-primary">
              {labels[vote.agent] ?? vote.agent} {vote.stance === "agree" ? "agrees" : "disagrees"} ({vote.severity})
              {vote.note && <span className="text-text-secondary">: {vote.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </button>
  );
}
