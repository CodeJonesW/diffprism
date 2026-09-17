import { describe, it, expect } from "vitest";
import { parseDiff, tokenize } from "react-diff-view";
import type { TokenNode } from "react-diff-view";
import { tokenizeHunks, refractorAdapter } from "../lib/tokenize-hunks";

// The shape from radius's main.tsx (#186): a /* opens in the first hunk and
// its */ is in the unchanged lines between hunks, which the diff doesn't show.
const DIFF = `diff --git a/main.tsx b/main.tsx
--- a/main.tsx
+++ b/main.tsx
@@ -1,3 +1,4 @@
 import { App } from './App.js';
+import { registerServiceWorker } from './sw.js';
 /*
  * The shared brand layer, imported ahead of this surface's own stylesheet
@@ -20,2 +21,3 @@
 installErrorReporting();
+registerServiceWorker();
 createRoot(root).render(App);
`;

const options = { refractor: refractorAdapter, highlight: true as const, language: "typescript" };

/** True when any token on the line is inside a comment. */
function isComment(line: TokenNode[] | undefined): boolean {
  const walk = (nodes: TokenNode[]): boolean =>
    nodes.some((n) => {
      const classes = (n as { properties?: { className?: string[] } }).properties?.className ?? [];
      return classes.includes("comment") || walk((n as { children?: TokenNode[] }).children ?? []);
    });
  return walk(line ?? []);
}

describe("tokenizeHunks (#186)", () => {
  const [file] = parseDiff(DIFF);

  it("reproduces the bug: one pass over all hunks leaks the open comment past the gap", () => {
    const leaky = tokenize(file.hunks, options);
    expect(isComment(leaky.new[21])).toBe(true); // registerServiceWorker(); — live code, shown as a comment
  });

  it("keeps live code after a collapsed region out of the comment", () => {
    const tokens = tokenizeHunks(file.hunks, options);
    expect(isComment(tokens.new[21])).toBe(false); // registerServiceWorker();
    expect(isComment(tokens.new[22])).toBe(false); // createRoot(...)
    expect(isComment(tokens.old[19])).toBe(false); // installErrorReporting(); on the old side
  });

  it("still highlights the comment inside its own hunk", () => {
    const tokens = tokenizeHunks(file.hunks, options);
    expect(isComment(tokens.new[3])).toBe(true); // " * The shared brand layer…"
  });

  it("puts every hunk line's tokens at its line number", () => {
    const tokens = tokenizeHunks(file.hunks, options);
    const text = (line: TokenNode[] | undefined): string =>
      (line ?? [])
        .map((n) => ("value" in n ? String(n.value) : text((n as { children?: TokenNode[] }).children)))
        .join("");
    expect(text(tokens.new[1])).toBe("import { registerServiceWorker } from './sw.js';");
    expect(text(tokens.new[21])).toBe("registerServiceWorker();");
  });
});
