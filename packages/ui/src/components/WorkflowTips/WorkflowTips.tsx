import { useEffect } from "react";
import { useReviewStore } from "../../store/review";
import {
  WORKFLOW_TIPS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
} from "../../data/workflow-tips";
import type { TipCategory } from "../../data/workflow-tips";

const STORAGE_KEY = "diffprism-tips-seen";

export function WorkflowTips() {
  const { showWorkflowTips, toggleWorkflowTips } = useReviewStore();

  // Auto-show on first visit
  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, "1");
      toggleWorkflowTips();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!showWorkflowTips) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        toggleWorkflowTips();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [showWorkflowTips, toggleWorkflowTips]);

  if (!showWorkflowTips) return null;

  // Group tips by category
  const grouped = new Map<TipCategory, typeof WORKFLOW_TIPS>();
  for (const tip of WORKFLOW_TIPS) {
    if (!grouped.has(tip.category)) grouped.set(tip.category, []);
    grouped.get(tip.category)!.push(tip);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={toggleWorkflowTips}
    >
      <div
        className="bg-surface border border-border rounded-lg shadow-xl p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-text-primary text-sm font-semibold mb-4">
          Workflow Tips
        </h2>

        <div className="space-y-4">
          {CATEGORY_ORDER.map((category) => {
            const tips = grouped.get(category);
            if (!tips || tips.length === 0) return null;

            return (
              <div key={category}>
                <h3 className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
                  {CATEGORY_LABELS[category]}
                </h3>
                <div className="space-y-1.5">
                  {tips.map((tip) => (
                    <div
                      key={tip.id}
                      className="flex items-start justify-between gap-3"
                    >
                      <span className="text-text-secondary text-sm leading-snug">
                        {tip.text}
                      </span>
                      {tip.shortcut && (
                        <kbd className="flex-shrink-0 px-1.5 py-0.5 text-xs font-mono rounded border border-border bg-background text-text-primary whitespace-nowrap">
                          {tip.shortcut}
                        </kbd>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-text-secondary/60 text-xs">
            Reopen anytime from the toolbar
          </span>
          <button
            onClick={toggleWorkflowTips}
            className="px-3 py-1.5 text-sm font-medium rounded bg-accent text-white hover:bg-accent/90 transition-colors cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
