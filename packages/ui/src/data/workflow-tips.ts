/**
 * Workflow Tips — single source of truth for the tips overlay.
 *
 * To add a tip:   append an entry to WORKFLOW_TIPS below.
 * To add a category: add to TipCategory union, CATEGORY_LABELS, and CATEGORY_ORDER.
 * No component changes needed.
 */

export type TipCategory = "navigation" | "review" | "commenting" | "general";

export interface TipDefinition {
  /** Unique identifier (used as React key) */
  id: string;
  /** Tip text shown to the user */
  text: string;
  /** Optional keyboard shortcut displayed as a <kbd> badge */
  shortcut?: string;
  /** Category for grouping */
  category: TipCategory;
}

/** Human-readable labels for each category */
export const CATEGORY_LABELS: Record<TipCategory, string> = {
  navigation: "Navigation",
  review: "Review Workflow",
  commenting: "Commenting",
  general: "General",
};

/** Display order for categories */
export const CATEGORY_ORDER: TipCategory[] = [
  "navigation",
  "review",
  "commenting",
  "general",
];

export const WORKFLOW_TIPS: TipDefinition[] = [
  {
    id: "nav-files",
    text: "Navigate between files in the sidebar",
    shortcut: "j / k",
    category: "navigation",
  },
  {
    id: "nav-hunks",
    text: "Jump between changed hunks within a file",
    shortcut: "n / p",
    category: "navigation",
  },
  {
    id: "nav-select",
    text: "Click any file in the sidebar to view its diff",
    category: "navigation",
  },
  {
    id: "review-status",
    text: "Cycle a file's review status (unreviewed → reviewed → approved → needs changes)",
    shortcut: "s",
    category: "review",
  },
  {
    id: "review-split",
    text: "Toggle between unified and split (side-by-side) diff views from the toolbar",
    category: "review",
  },
  {
    id: "review-briefing",
    text: "Check the briefing bar at the top for a summary of changes, risk indicators, and file stats",
    category: "review",
  },
  {
    id: "comment-gutter",
    text: "Click a line's gutter (the + icon on hover) to add an inline comment",
    category: "commenting",
  },
  {
    id: "comment-hunk",
    text: "Quickly comment on the focused hunk",
    shortcut: "c",
    category: "commenting",
  },
  {
    id: "comment-save",
    text: "Save a comment from the inline form",
    shortcut: "Cmd/Ctrl + Enter",
    category: "commenting",
  },
  {
    id: "general-hotkeys",
    text: "Open the full keyboard shortcuts reference anytime",
    shortcut: "?",
    category: "general",
  },
  {
    id: "general-theme",
    text: "Toggle between dark and light mode from the toolbar",
    category: "general",
  },
];
