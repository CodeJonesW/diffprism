/**
 * Centralized semantic color classes for badges, statuses, and categories.
 *
 * All colors reference CSS custom properties via Tailwind semantic tokens
 * (success, danger, warning, info, neutral, perf, accent) so they auto-switch
 * between light and dark mode — no `dark:` prefixes needed.
 */

/* ── Review status badges (SessionList, submitted screens) ── */

export const STATUS_BADGE_STYLES: Record<string, string> = {
  pending: "bg-warning/20 text-warning border border-warning/30",
  in_review: "bg-accent/20 text-accent border border-accent/30",
  changes_requested: "bg-danger/20 text-danger border border-danger/30",
  approved: "bg-success/20 text-success border border-success/30",
  approved_with_comments: "bg-success/20 text-success border border-success/30",
  dismissed: "bg-neutral/20 text-neutral border border-neutral/30",
  submitted: "bg-success/20 text-success border border-success/30",
};

/* ── Inline comment type badges ── */

export const COMMENT_TYPE_STYLES: Record<string, string> = {
  must_fix: "bg-danger/15 text-danger border-danger/30",
  suggestion: "bg-warning/15 text-warning border-warning/30",
  question: "bg-info/15 text-info border-info/30",
  nitpick: "bg-neutral/15 text-neutral border-neutral/30",
};

/* ── File status badges (A/M/D/R) ── */

export const FILE_STATUS_BADGE_STYLES: Record<string, string> = {
  added: "bg-success/15 text-success border-success/30",
  modified: "bg-warning/15 text-warning border-warning/30",
  deleted: "bg-danger/15 text-danger border-danger/30",
  renamed: "bg-accent/15 text-accent border-accent/30",
};

export const FILE_STATUS_ICON_COLORS: Record<string, string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-danger",
  renamed: "text-accent",
};

/* ── File review status icon colors ── */

export const FILE_REVIEW_ICON_COLORS: Record<string, string> = {
  reviewed: "text-info",
  approved: "text-success",
  needs_changes: "text-warning",
};

/* ── Annotation category colors + badge styles ── */

export const CATEGORY_COLORS: Record<string, string> = {
  security: "text-danger",
  performance: "text-perf",
  convention: "text-info",
  correctness: "text-warning",
  complexity: "text-accent",
  "test-coverage": "text-info",
  documentation: "text-neutral",
  other: "text-neutral",
};

export const CATEGORY_BADGE_STYLES: Record<string, string> = {
  security: "bg-danger/15 text-danger border-danger/30",
  performance: "bg-perf/15 text-perf border-perf/30",
  convention: "bg-info/15 text-info border-info/30",
  correctness: "bg-warning/15 text-warning border-warning/30",
  complexity: "bg-accent/15 text-accent border-accent/30",
  "test-coverage": "bg-info/15 text-info border-info/30",
  documentation: "bg-neutral/15 text-neutral border-neutral/30",
  other: "bg-neutral/15 text-neutral border-neutral/30",
};

/* ── Action button styles (ActionBar) ── */

export const ACTION_BUTTON_STYLES: Record<string, string> = {
  approve:
    "bg-success/15 text-success border border-success/30 hover:bg-success/25 hover:border-success/50",
  reject:
    "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 hover:border-danger/50",
  comment:
    "bg-info/15 text-info border border-info/30 hover:bg-info/25 hover:border-info/50",
  dismiss:
    "bg-neutral/15 text-neutral border border-neutral/30 hover:bg-neutral/25 hover:border-neutral/50",
};

/* ── Briefing bar pill styles ── */

export const BRIEFING_BADGE_STYLES: Record<string, string> = {
  security: "bg-danger/15 text-danger border border-danger/30",
  breaking: "bg-danger/15 text-danger border border-danger/30",
  modules: "bg-info/15 text-info border border-info/30",
  deps: "bg-warning/15 text-warning border border-warning/30",
  complexity: "bg-perf/15 text-perf border border-perf/30",
  coverage: "bg-warning/15 text-warning border border-warning/30",
  patterns: "bg-accent/15 text-accent border border-accent/30",
};

export const BRIEFING_SECTION_COLORS: Record<string, string> = {
  security: "text-danger",
  breaking: "text-danger",
  deps: "text-warning",
  complexity: "text-perf",
  coverage: "text-warning",
  patterns: "text-accent",
};

/* ── Stage badges (DiffViewer file header) ── */

export const STAGE_BADGE_STYLES: Record<string, string> = {
  staged: "bg-success/20 text-success border-success/30",
  unstaged: "bg-warning/20 text-warning border-warning/30",
};

/* ── Severity badges (BriefingBar security flags) ── */

export const SEVERITY_BADGE_STYLES: Record<string, string> = {
  critical: "bg-danger/15 text-danger border border-danger/30",
  warning: "bg-warning/15 text-warning border border-warning/30",
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-danger",
  warning: "text-warning",
};
