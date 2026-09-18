import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useReviewStore } from "../../store/review";

/** Shows or hides the review's file sidebar. Its size is kept for when it comes back. */
export function SidebarToggle() {
  const collapsed = useReviewStore((s) => s.panes["review-sidebar"].collapsed);
  const setPane = useReviewStore((s) => s.setPane);

  return (
    <button
      onClick={() => setPane("review-sidebar", { collapsed: !collapsed })}
      className="p-1 -ml-1 rounded text-text-secondary hover:text-text-primary transition-colors cursor-pointer flex-shrink-0"
      title={collapsed ? "Show files" : "Hide files"}
    >
      {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
    </button>
  );
}
