/**
 * The MCP tools DiffPrism registers, and the ones it used to.
 *
 * `diffprism setup` grants permission to these by name and `teardown` removes
 * them by name. Each used to keep its own list, the two had already drifted
 * apart — teardown never removed `review_pr`, so uninstalling left it behind
 * — and neither covered the PR tools. The MCP server's test asserts that what
 * it registers matches MCP_TOOL_NAMES exactly, so this cannot drift from the
 * server either.
 */
export const MCP_TOOL_NAMES = [
  "open_review",
  "get_review_result",
  "update_review_context",
  "get_diff",
  "analyze_diff",
  "annotate",
  "get_review_state",
  "get_review_comments",
  "get_user_focus",
  "get_pr_context",
  "get_file_diff",
  "get_file_context",
] as const;

/**
 * Tools earlier versions registered. Setup prunes their permissions on
 * upgrade and teardown removes them, so an install never outlives its tools.
 */
export const RETIRED_MCP_TOOL_NAMES = [
  "add_annotation",
  "add_review_comment",
  "flag_for_attention",
  "review_pr",
] as const;

/** The permission string Claude Code uses for a DiffPrism MCP tool. */
export function mcpToolPermission(name: string): string {
  return `mcp__diffprism__${name}`;
}
