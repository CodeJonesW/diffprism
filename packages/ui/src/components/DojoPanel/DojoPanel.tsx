import { useEffect, useState } from "react";
import { Swords, Loader2, Check, X, PanelRightClose, AlertTriangle, CircleCheck, CircleX, Send } from "lucide-react";
import type {
  Annotation,
  DojoAvailableAgent,
  DojoCombinedFinding,
  DojoConsensus,
  DojoSeat,
  DojoSeverity,
  DojoState,
  ReviewAgentName,
} from "../../types";
import { useHttpApi } from "../../hooks/useHttpApi";
import { useAgentPickup } from "../../hooks/useAgentPickup";
import { useReviewStore } from "../../store/review";
import { ASK_AGENT, findingSent } from "../../lib/dojo-send";
import type { FindingSent } from "../../lib/dojo-send";

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

/**
 * A local review's threads, for sending findings to the agent that made the
 * change (#238). A PR review has no such agent here: its decision goes to
 * GitHub.
 */
export interface DojoSendBack {
  annotations: Annotation[];
  /** SessionSummary.agentReadAt of the review. */
  agentReadAt: number | undefined;
}

interface DojoPanelProps {
  sessionId: string;
  dojo: DojoState | null;
  /** Go to the finding's thread on its line. */
  onNavigate: (finding: DojoCombinedFinding) => void;
  onHide: () => void;
  sendBack?: DojoSendBack;
}

/**
 * The review dojo (#231): pick the agents, they review the change on their
 * own and vote on each other's findings, and this shows where they agree and
 * where they don't. Each finding is also a thread on its line and, on a local
 * review, can be sent to the agent that made the change (#238).
 */
export function DojoPanel({ sessionId, dojo, onNavigate, onHide, sendBack }: DojoPanelProps) {
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
          <Results
            sessionId={sessionId}
            dojo={dojo}
            onNavigate={onNavigate}
            onRunAgain={() => setChoosing(true)}
            sendBack={sendBack}
          />
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
        Each agent reviews this change on its own, then votes on what the others found. You get one list, with who agrees
        and who doesn't.
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
  sessionId,
  dojo,
  onNavigate,
  onRunAgain,
  sendBack,
}: {
  sessionId: string;
  dojo: DojoState;
  onNavigate: (finding: DojoCombinedFinding) => void;
  onRunAgain: () => void;
  sendBack?: DojoSendBack;
}) {
  const labels = Object.fromEntries(dojo.agents.map((a) => [a.agent.name, a.label])) as Record<ReviewAgentName, string>;
  const dropped = dojo.agents.filter((a) => a.error);
  const dismissAnnotation = useReviewStore((s) => s.dismissAnnotation);
  const pickup = useAgentPickup(sendBack?.annotations ?? [], sendBack?.agentReadAt);
  const threadOf = (f: DojoCombinedFinding) => sendBack?.annotations.find((a) => a.id === f.annotationId);
  const sentOf = (f: DojoCombinedFinding) => findingSent(threadOf(f), pickup);
  // Agreed findings are the obvious ones to send; the rest are the reviewer's call.
  const [chosen, setChosen] = useState<Set<string>>(
    () =>
      new Set(
        dojo.findings
          .filter((f) => {
            const sent = sentOf(f);
            return f.consensus === "agreed" && threadOf(f) && sent.asked === null && !sent.dismissed;
          })
          .map((f) => f.id),
      ),
  );
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
      {sendBack && dojo.findings.length > 0 && (
        <SendBar
          sessionId={sessionId}
          chosen={dojo.findings.filter((f) => chosen.has(f.id))}
          sentOf={sentOf}
          onSent={(ids) =>
            setChosen((current) => new Set([...current].filter((id) => !ids.includes(id))))
          }
        />
      )}
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
                <li key={f.id} className="flex items-start gap-2">
                  {sendBack && (
                    <input
                      type="checkbox"
                      className="mt-2.5"
                      checked={chosen.has(f.id) && !sentOf(f).dismissed}
                      disabled={!threadOf(f) || sentOf(f).dismissed}
                      onChange={() => toggle(f.id)}
                      aria-label={`Choose “${f.title}”`}
                    />
                  )}
                  <FindingCard
                    finding={f}
                    labels={labels}
                    onNavigate={onNavigate}
                    sent={sendBack ? sentOf(f) : undefined}
                    onDismiss={sendBack && f.annotationId && threadOf(f) ? () => dismissAnnotation(f.annotationId!) : undefined}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/**
 * Send the chosen findings to the agent that made the change to fix (#238,
 * #256). Each goes as a request on its own thread, which the agent's next
 * wait on the review hands over, so each can be followed on its card: sent,
 * picked up, then fixed or answered. This is the only way a finding reaches
 * the agent: a request for changes ends the round and tracks nothing per
 * finding, so the ActionBar's Request Changes is for the reviewer's own words.
 */
function SendBar({
  sessionId,
  chosen,
  sentOf,
  onSent,
}: {
  sessionId: string;
  chosen: DojoCombinedFinding[];
  sentOf: (f: DojoCombinedFinding) => FindingSent;
  onSent: (ids: string[]) => void;
}) {
  const { replyToThread } = useHttpApi();
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const count = (n: number) => `${n} finding${n === 1 ? "" : "s"}`;

  // A request already waiting on the agent isn't sent twice, and a dismissed
  // finding goes nowhere. Sending a fixed or answered one again reopens it.
  const toSend = chosen.filter((f) => {
    const { asked, dismissed } = sentOf(f);
    return !dismissed && (asked === null || asked === "answered" || asked === "fixed");
  });

  async function send() {
    setSending(true);
    setNotice(null);
    const results = await Promise.all(toSend.map((f) => replyToThread(sessionId, f.annotationId!, ASK_AGENT)));
    setSending(false);
    const failed = results.find((r) => !r.ok);
    onSent(toSend.filter((_, i) => results[i].ok).map((f) => f.id));
    setNotice(
      failed
        ? { ok: false, text: `${results.filter((r) => !r.ok).length} didn't send: ${failed.error}` }
        : {
            ok: true,
            text: `Sent ${count(toSend.length)} to the agent. Each card shows when it has them, and when each is fixed.`,
          },
    );
  }

  const button =
    "flex items-center gap-1.5 bg-accent/15 text-accent text-xs font-medium rounded-md px-2.5 py-1.5 hover:bg-accent/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2" aria-label="Send to the agent">
      <p className="text-xs text-text-secondary">
        Send the ticked findings to the agent that made this change. It fixes each one without committing and marks it
        fixed, or replies with why not.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={send} disabled={sending || toSend.length === 0} className={button}>
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Send to the agent to fix ({toSend.length})
        </button>
      </div>
      {notice && <p className={`text-xs ${notice.ok ? "text-text-secondary" : "text-danger"}`}>{notice.text}</p>}
    </div>
  );
}

const ASKED_TEXT: Record<Exclude<NonNullable<FindingSent["asked"]>, "fixed">, string> = {
  pending: "Sent to the agent",
  picked_up: "Sent to the agent — it has it",
  unheard: "Sent — no agent is waiting on this review yet. It gets this the next time one does.",
  answered: "The agent answered — see the thread",
};

function FindingCard({
  finding,
  labels,
  onNavigate,
  sent,
  onDismiss,
}: {
  finding: DojoCombinedFinding;
  labels: Record<ReviewAgentName, string>;
  onNavigate: (finding: DojoCombinedFinding) => void;
  /** Where it stands with the agent that made the change, on a local review. */
  sent?: FindingSent;
  /** Dismiss its thread: done with it, fixed or not (#256). Absent when there's no thread to dismiss. */
  onDismiss?: () => void;
}) {
  const dismissed = !!sent?.dismissed;
  return (
    <div className={`w-full rounded-md border border-border bg-background ${dismissed ? "opacity-60" : ""}`}>
      <FindingBody finding={finding} labels={labels} onNavigate={onNavigate} />
      {sent && (sent.asked || dismissed || onDismiss) && (
        <div className="px-3 pb-2 space-y-1">
          {sent.asked === "fixed" ? (
            <div className="flex gap-1.5 text-xs">
              <CircleCheck className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" />
              <p>
                <span className="text-success font-medium">Fixed by the agent</span>
                {sent.fixedNote && <span className="text-text-primary">: {sent.fixedNote}</span>}
              </p>
            </div>
          ) : (
            sent.asked && (
              <p className={`text-xs ${sent.asked === "unheard" ? "text-warning" : "text-accent"}`}>{ASKED_TEXT[sent.asked]}</p>
            )
          )}
          {dismissed ? (
            <p className="text-xs text-text-secondary">Dismissed</p>
          ) : (
            onDismiss && (
              <button onClick={onDismiss} className="text-xs text-text-secondary hover:text-text-primary hover:underline">
                Dismiss
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

/** The finding itself; clicking it goes to its thread on its line. */
function FindingBody({
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
      className="w-full text-left rounded-md px-3 py-2 hover:bg-border/20 transition-colors"
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
