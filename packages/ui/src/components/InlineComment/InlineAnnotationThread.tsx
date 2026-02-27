import {
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  AlertCircle,
  X,
  Bot,
} from "lucide-react";
import type { Annotation } from "../../types";
import { CATEGORY_COLORS, CATEGORY_BADGE_STYLES } from "../../lib/semantic-colors";

const TYPE_ICONS: Record<string, typeof AlertTriangle> = {
  finding: AlertCircle,
  suggestion: Lightbulb,
  question: HelpCircle,
  warning: AlertTriangle,
};

interface InlineAnnotationThreadProps {
  annotations: Annotation[];
  onDismiss: (annotationId: string) => void;
}

export function InlineAnnotationThread({
  annotations,
  onDismiss,
}: InlineAnnotationThreadProps) {
  if (annotations.length === 0) return null;

  return (
    <div className="border-t border-border bg-surface">
      <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-border/50">
        <Bot className="w-3 h-3 text-text-secondary" />
        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">
          Agent {annotations.length === 1 ? "Annotation" : `Annotations (${annotations.length})`}
        </span>
      </div>

      {annotations.map((annotation) => {
        const Icon = TYPE_ICONS[annotation.type] ?? AlertCircle;
        const colorClass =
          CATEGORY_COLORS[annotation.category] ?? CATEGORY_COLORS.other;
        const badgeStyle =
          CATEGORY_BADGE_STYLES[annotation.category] ?? CATEGORY_BADGE_STYLES.other;

        return (
          <div
            key={annotation.id}
            className="px-3 py-2 border-b border-border/50 group/annotation"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${colorClass}`} />
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badgeStyle}`}
              >
                {annotation.category}
              </span>
              <span className="text-text-secondary text-[10px]">
                {annotation.source.agent}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => onDismiss(annotation.id)}
                className="opacity-0 group-hover/annotation:opacity-100 p-0.5 rounded hover:bg-text-primary/10 text-text-secondary transition-all cursor-pointer flex-shrink-0"
                title="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <p className="text-text-primary text-sm whitespace-pre-wrap">
              {annotation.body}
            </p>
          </div>
        );
      })}
    </div>
  );
}
