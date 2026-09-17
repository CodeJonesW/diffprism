import { useState } from "react";
import {
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  AlertCircle,
  X,
  Bot,
  User,
  MessageSquare,
  Copy,
  Check,
} from "lucide-react";
import type { Annotation, AnnotationReply } from "../../types";
import { CATEGORY_COLORS, CATEGORY_BADGE_STYLES } from "../../lib/semantic-colors";
import { awaitingAgent } from "../../lib/threads";
import { useAgentPickup } from "../../hooks/useAgentPickup";
import { ThreadForm } from "./ThreadForm";

const TYPE_ICONS: Record<string, typeof AlertTriangle> = {
  finding: AlertCircle,
  suggestion: Lightbulb,
  question: HelpCircle,
  warning: AlertTriangle,
};

type SendResult = { ok: boolean; error?: string };

interface InlineAnnotationThreadProps {
  annotations: Annotation[];
  onDismiss: (annotationId: string) => void;
  /** Present when replies can be posted — i.e. connected to a server session. */
  onReply?: (annotationId: string, body: string) => Promise<SendResult>;
  /** The review these threads belong to — named when telling the reviewer how to reach an agent. */
  sessionId?: string;
  /** SessionSummary.agentReadAt of that review. */
  agentReadAt?: number;
}

function AuthorLabel({ author, agent }: { author: "agent" | "reviewer"; agent?: string }) {
  return author === "reviewer" ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent">
      <User className="w-3 h-3" />
      You
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary">
      <Bot className="w-3 h-3" />
      {agent ?? "agent"}
    </span>
  );
}

function Reply({ reply }: { reply: AnnotationReply }) {
  return (
    <div className="pl-3 ml-1.5 border-l border-border/70 py-1">
      <AuthorLabel author={reply.author} agent={reply.agent} />
      <p className="text-text-primary text-sm whitespace-pre-wrap mt-0.5">{reply.body}</p>
    </div>
  );
}

/**
 * Nothing will answer this thread until the reviewer starts an agent. The
 * prompt to give it is its own snippet — one click selects all of it, and
 * Copy puts it on the clipboard — rather than words inside a sentence.
 */
function UnheardNotice({ sessionId }: { sessionId?: string }) {
  const prompt = `Answer my DiffPrism comments${sessionId ? ` on ${sessionId}` : ""}`;
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <div className="mt-1.5 text-[11px]">
      <p className="text-warning">No agent is listening, so nothing will answer this. Ask Claude Code:</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="select-all px-1.5 py-0.5 rounded border border-border bg-background text-text-primary">
          {prompt}
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(prompt).then(
              () => setCopy("copied"),
              () => setCopy("failed"),
            );
          }}
          className="inline-flex items-center gap-1 text-text-secondary hover:text-accent transition-colors cursor-pointer"
          title="Copy prompt"
        >
          {copy === "copied" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed — select the text instead" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function InlineAnnotationThread({
  annotations,
  onDismiss,
  onReply,
  sessionId,
  agentReadAt,
}: InlineAnnotationThreadProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const pickup = useAgentPickup(annotations, agentReadAt);

  if (annotations.length === 0) return null;

  const isConversation = annotations.some(
    (a) => (a.author ?? "agent") === "reviewer" || (a.replies?.length ?? 0) > 0,
  );

  return (
    <div className="border-t border-border bg-surface">
      <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-border/50">
        {isConversation ? (
          <MessageSquare className="w-3 h-3 text-text-secondary" />
        ) : (
          <Bot className="w-3 h-3 text-text-secondary" />
        )}
        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">
          {isConversation
            ? `Discussion${annotations.length > 1 ? ` (${annotations.length})` : ""}`
            : `Agent ${annotations.length === 1 ? "Annotation" : `Annotations (${annotations.length})`}`}
        </span>
      </div>

      {annotations.map((annotation) => {
        const author = annotation.author ?? "agent";
        const Icon = TYPE_ICONS[annotation.type] ?? AlertCircle;
        const colorClass = CATEGORY_COLORS[annotation.category] ?? CATEGORY_COLORS.other;
        const badgeStyle = CATEGORY_BADGE_STYLES[annotation.category] ?? CATEGORY_BADGE_STYLES.other;
        const replies = annotation.replies ?? [];

        return (
          <div key={annotation.id} data-annotation-id={annotation.id} className="px-3 py-2 border-b border-border/50 group/annotation">
            <div className="flex items-center gap-2 mb-1">
              {author === "agent" ? (
                <>
                  <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${colorClass}`} />
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badgeStyle}`}>
                    {annotation.category}
                  </span>
                  <span className="text-text-secondary text-[10px]">{annotation.source.agent}</span>
                </>
              ) : (
                <AuthorLabel author="reviewer" />
              )}
              <div className="flex-1" />
              <button
                onClick={() => onDismiss(annotation.id)}
                className="opacity-0 group-hover/annotation:opacity-100 p-0.5 rounded hover:bg-text-primary/10 text-text-secondary transition-all cursor-pointer flex-shrink-0"
                title="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            <p className="text-text-primary text-sm whitespace-pre-wrap">{annotation.body}</p>

            {replies.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {replies.map((reply) => (
                  <Reply key={reply.id} reply={reply} />
                ))}
              </div>
            )}

            {awaitingAgent(annotation) &&
              (pickup(annotation) === "unheard" ? (
                <UnheardNotice sessionId={sessionId} />
              ) : (
                <p className="mt-1.5 text-[11px] text-text-secondary italic">
                  Waiting for the agent to reply.
                </p>
              ))}

            {onReply &&
              (replyingTo === annotation.id ? (
                <div className="-mx-3">
                  <ThreadForm
                    placeholder="Reply…"
                    submitLabel="Reply"
                    onSubmit={async (body) => {
                      const result = await onReply(annotation.id, body);
                      if (result.ok) setReplyingTo(null);
                      return result;
                    }}
                    onCancel={() => setReplyingTo(null)}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setReplyingTo(annotation.id)}
                  className="mt-1 text-[11px] text-text-secondary hover:text-accent transition-colors cursor-pointer"
                >
                  Reply
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
