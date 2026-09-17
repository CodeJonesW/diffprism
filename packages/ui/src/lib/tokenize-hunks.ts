import { tokenize } from "react-diff-view";
import type { HunkData, HunkTokens, TokenizeOptions, TokenNode } from "react-diff-view";
import { refractor } from "refractor";

/**
 * Adapter for refractor v4 to work with react-diff-view's tokenize function.
 *
 * react-diff-view expects `refractor.highlight(code, lang)` to return an array
 * of HAST nodes (the old refractor v2 API). Refractor v4 returns a Root node
 * with a `.children` property. This wrapper unwraps it.
 */
export const refractorAdapter: {
  highlight(code: string, language: string): ReturnType<typeof refractor.highlight>["children"];
  registered(language: string): boolean;
} = {
  highlight(code: string, language: string) {
    const root = refractor.highlight(code, language);
    return root.children;
  },
  registered(language: string) {
    return refractor.registered(language);
  },
};

/**
 * Tokenize a file's hunks one hunk at a time.
 *
 * Without the file's source, react-diff-view's `tokenize` joins every hunk into
 * one text — blank lines where the unchanged gaps are — and highlights it in a
 * single pass. Grammar state then leaks across the gaps: a `/*` whose `*\/` is
 * in a collapsed region turns everything after it into a comment, and live
 * code reads as commented out (#186). Highlighting each hunk on its own keeps
 * state inside the hunk; the results are indexed by line number, so they merge.
 */
export function tokenizeHunks(hunks: HunkData[], options: TokenizeOptions): HunkTokens {
  const merged: HunkTokens = { old: [], new: [] };
  for (const hunk of hunks) {
    const tokens = tokenize([hunk], options);
    copyLines(tokens.old, merged.old, hunk.oldStart, hunk.oldLines);
    copyLines(tokens.new, merged.new, hunk.newStart, hunk.newLines);
  }
  return merged;
}

function copyLines(from: TokenNode[][], to: TokenNode[][], start: number, count: number): void {
  for (let line = start; line < start + count; line++) {
    to[line - 1] = from[line - 1] ?? [];
  }
}
