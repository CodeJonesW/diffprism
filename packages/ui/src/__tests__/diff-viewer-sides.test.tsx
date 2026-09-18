/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { DiffViewer } from "../components/DiffViewer";
import { useReviewStore } from "../store/review";
import type { Annotation, DiffSet, ReviewComment } from "../types";

// Line 2 is replaced: the deleted "two old" is old-file line 2, and the added
// "two new" is new-file line 2. Same number, different lines.
const rawDiff = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 const one = 1;
-const two = "old";
+const two = "new";
 const three = 3;
`;

const diffSet: DiffSet = {
  baseRef: "HEAD",
  headRef: "working-copy",
  files: [
    {
      path: "a.ts",
      status: "modified",
      hunks: [],
      language: "typescript",
      binary: false,
      additions: 1,
      deletions: 1,
    },
  ],
};

function thread(id: string, side: "old" | "new", body: string): Annotation {
  return {
    id, sessionId: "s1", file: "a.ts", line: 2, side, body, type: "question",
    confidence: 1, category: "other", source: { agent: "reviewer" }, createdAt: 1, author: "reviewer",
  };
}

function comment(side: "old" | "new", body: string): ReviewComment {
  return { file: "a.ts", line: 2, side, body, type: "question" };
}

/** The text of the widget row react-diff-view renders right after the row holding `code`. */
function widgetAfter(code: string): string {
  const row = screen.getByText(code, { exact: false }).closest("tr");
  expect(row).not.toBeNull();
  const next = row!.nextElementSibling;
  return next?.classList.contains("diff-widget") ? (next.textContent ?? "") : "";
}

describe("comments and threads on a replaced line (#175)", () => {
  beforeEach(() => {
    useReviewStore.setState({
      diffSet,
      rawDiff,
      selectedFile: "a.ts",
      viewMode: "unified",
      metadata: { title: "t" },
      comments: [],
      annotations: [],
      activeCommentKey: null,
      reviewId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a thread on the deleted line under the deleted line only", () => {
    useReviewStore.setState({
      annotations: [thread("gone", "old", "why remove this?"), thread("added", "new", "why add this?")],
    });
    render(<DiffViewer />);

    expect(widgetAfter(`"old"`)).toContain("why remove this?");
    expect(widgetAfter(`"old"`)).not.toContain("why add this?");
    expect(widgetAfter(`"new"`)).toContain("why add this?");
    expect(widgetAfter(`"new"`)).not.toContain("why remove this?");
  });

  it("shows a local comment on the deleted line under the deleted line only", () => {
    useReviewStore.setState({
      comments: [comment("old", "keep this check"), comment("new", "rename this")],
    });
    render(<DiffViewer />);

    expect(widgetAfter(`"old"`)).toContain("keep this check");
    expect(widgetAfter(`"old"`)).not.toContain("rename this");
    expect(widgetAfter(`"new"`)).toContain("rename this");
    expect(widgetAfter(`"new"`)).not.toContain("keep this check");
  });
});
