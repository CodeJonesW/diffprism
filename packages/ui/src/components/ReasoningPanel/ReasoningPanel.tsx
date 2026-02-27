import { useState } from "react";
import { Brain, ChevronDown, ChevronUp } from "lucide-react";
import { useReviewStore } from "../../store/review";

export function ReasoningPanel() {
  const [expanded, setExpanded] = useState(false);
  const { metadata } = useReviewStore();

  if (!metadata?.reasoning) return null;

  return (
    <div className="bg-surface border-b border-border flex-shrink-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-text-primary/5 transition-colors"
      >
        <Brain className="w-4 h-4 text-accent flex-shrink-0" />
        <span className="text-text-primary text-sm flex-1 text-left truncate">
          Agent Reasoning
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-text-secondary" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-secondary" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-border/50 pt-3">
          <p className="text-text-secondary text-sm whitespace-pre-wrap">
            {metadata.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
