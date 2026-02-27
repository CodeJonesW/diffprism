import { useState, useMemo, useCallback } from "react";
import {
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  AlertCircle,
  X,
  Eye,
  EyeOff,
  Bot,
} from "lucide-react";
import type { Annotation } from "../../types";
import { CATEGORY_COLORS } from "../../lib/semantic-colors";

const TYPE_ICONS: Record<string, typeof AlertTriangle> = {
  finding: AlertCircle,
  suggestion: Lightbulb,
  question: HelpCircle,
  warning: AlertTriangle,
};

interface AnnotationPanelProps {
  annotations: Annotation[];
  onDismiss: (annotationId: string) => void;
  onNavigate: (file: string) => void;
}

function AnnotationBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = body.length > 120 || body.includes("\n");

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  if (!isLong) {
    return <p className="text-xs text-text-primary">{body}</p>;
  }

  if (expanded) {
    return (
      <div>
        <p className="text-xs text-text-primary whitespace-pre-wrap">{body}</p>
        <button onClick={toggle} className="text-[10px] text-accent hover:underline mt-0.5 cursor-pointer">
          Show less
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-text-primary truncate">{body}</p>
      <button onClick={toggle} className="text-[10px] text-accent hover:underline mt-0.5 cursor-pointer">
        Show more
      </button>
    </div>
  );
}

export function AnnotationPanel({
  annotations,
  onDismiss,
  onNavigate,
}: AnnotationPanelProps) {
  const [showDismissed, setShowDismissed] = useState(false);

  const grouped = useMemo(() => {
    const filtered = showDismissed
      ? annotations
      : annotations.filter((a) => !a.dismissed);

    const groups = new Map<string, Annotation[]>();
    for (const a of filtered) {
      const agent = a.source.agent;
      if (!groups.has(agent)) groups.set(agent, []);
      groups.get(agent)!.push(a);
    }
    return groups;
  }, [annotations, showDismissed]);

  const activeCount = annotations.filter((a) => !a.dismissed).length;

  if (annotations.length === 0) return null;

  return (
    <div className="border-t border-border">
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-text-secondary" />
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Agent Annotations ({activeCount})
          </span>
        </div>
        {annotations.some((a) => a.dismissed) && (
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
          >
            {showDismissed ? (
              <EyeOff className="w-3 h-3" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            {showDismissed ? "Hide dismissed" : "Show dismissed"}
          </button>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto">
        {Array.from(grouped.entries()).map(([agent, agentAnnotations]) => (
          <div key={agent} className="border-t border-border/50">
            <div className="px-4 py-1.5 flex items-center gap-2">
              <span className="text-xs font-medium text-accent">{agent}</span>
              <span className="text-xs text-text-secondary">
                ({agentAnnotations.length})
              </span>
            </div>

            {agentAnnotations.map((annotation) => {
              const Icon = TYPE_ICONS[annotation.type] ?? AlertCircle;
              const colorClass =
                CATEGORY_COLORS[annotation.category] ?? CATEGORY_COLORS.other;

              return (
                <div
                  key={annotation.id}
                  className={`px-4 py-2 flex items-start gap-2 hover:bg-text-primary/5 cursor-pointer group ${
                    annotation.dismissed ? "opacity-40" : ""
                  }`}
                  onClick={() => onNavigate(annotation.file)}
                >
                  <Icon
                    className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${colorClass}`}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-text-secondary font-mono truncate">
                        {annotation.file}:{annotation.line}
                      </span>
                      <span
                        className={`text-[10px] font-semibold uppercase ${colorClass}`}
                      >
                        {annotation.category}
                      </span>
                    </div>
                    <AnnotationBody body={annotation.body} />
                  </div>

                  {!annotation.dismissed && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(annotation.id);
                      }}
                      className="p-0.5 rounded hover:bg-text-primary/10 text-text-secondary opacity-0 group-hover:opacity-100 cursor-pointer flex-shrink-0"
                      title="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
