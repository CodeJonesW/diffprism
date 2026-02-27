import {
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  AlertCircle,
  X,
  Bot,
} from "lucide-react";
import type { Annotation } from "../../types";

const CATEGORY_COLORS: Record<string, string> = {
  security: "text-red-500 dark:text-red-400",
  performance: "text-orange-500 dark:text-orange-400",
  convention: "text-blue-500 dark:text-blue-400",
  correctness: "text-yellow-500 dark:text-yellow-400",
  complexity: "text-purple-500 dark:text-purple-400",
  "test-coverage": "text-cyan-500 dark:text-cyan-400",
  documentation: "text-gray-500 dark:text-gray-400",
  other: "text-gray-500 dark:text-gray-400",
};

const CATEGORY_BADGE_STYLES: Record<string, string> = {
  security: "bg-red-600/15 text-red-600 dark:text-red-400 border-red-500/30",
  performance: "bg-orange-600/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  convention: "bg-blue-600/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  correctness: "bg-yellow-600/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  complexity: "bg-purple-600/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  "test-coverage": "bg-cyan-600/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  documentation: "bg-gray-600/15 text-gray-600 dark:text-gray-400 border-gray-500/30",
  other: "bg-gray-600/15 text-gray-600 dark:text-gray-400 border-gray-500/30",
};

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
