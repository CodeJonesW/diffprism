/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiffViewer } from "../components/DiffViewer";
import { SinceBanner } from "../components/SinceBanner";
import { DojoPanel } from "../components/DojoPanel";
import { useReviewStore } from "../store/review";
import type { Annotation, DiffSet, DojoState, SinceLastLook } from "../types";

// ─── #265: what changed since the reviewer last looked ───

// Two hunks: the first was there when the reviewer looked, the second is the agent's fix.
const rawDiff = `diff --git a/src/cache.ts b/src/cache.ts
index 1111111..2222222 100644
--- a/src/cache.ts
+++ b/src/cache.ts
@@ -1,2 +1,3 @@
 const cache = new Map();
+const seenBefore = true;
 export { cache };
@@ -20,2 +21,3 @@
 function evict() {
+  const fixedNow = true;
 }
`;

const diffSet: DiffSet = {
  baseRef: "HEAD",
  headRef: "staged",
  files: [{ path: "src/cache.ts", status: "modified", hunks: [], language: "typescript", binary: false, additions: 2, deletions: 0 }],
};

const since: SinceLastLook = {
  files: [
    { key: "src/cache.ts", path: "src/cache.ts", status: "changed", hunks: [1], lines: [{ start: 22, end: 22 }], additions: 1, deletions: 0, droppedHunks: 0 },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.pushState({}, "", "/?httpPort=24680");
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  useReviewStore.setState({
    reviewId: "s1",
    diffSet,
    rawDiff,
    selectedFile: "src/cache.ts",
    viewMode: "unified",
    metadata: { title: "t" },
    comments: [],
    annotations: [],
    activeCommentKey: null,
    since: null,
    sinceOnly: false,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the diff", () => {
  it("labels the hunks that are new since the last look", () => {
    useReviewStore.getState().setSince(since);
    render(<DiffViewer />);
    expect(screen.getAllByText("New since you last looked")).toHaveLength(1);
    expect(screen.getByText(/seenBefore/)).toBeTruthy();
    expect(screen.getByText(/fixedNow/)).toBeTruthy();
  });

  it("shows only the new hunks when asked", () => {
    useReviewStore.getState().setSince(since);
    useReviewStore.getState().setSinceOnly(true);
    render(<DiffViewer />);
    expect(screen.queryByText(/seenBefore/)).toBeNull();
    expect(screen.getByText(/fixedNow/)).toBeTruthy();
  });

  it("says so when the file shown has nothing new", () => {
    useReviewStore.getState().setSince({ files: [{ ...since.files[0], key: "other.ts", path: "other.ts" }] });
    useReviewStore.getState().setSinceOnly(true);
    render(<DiffViewer />);
    expect(screen.getByText("No changes in this file since you last looked.")).toBeTruthy();
  });

  it("keeps the whole diff for a file whose only change is removals, and says what's gone", () => {
    useReviewStore.getState().setSince({ files: [{ ...since.files[0], hunks: [], lines: [], additions: 0, droppedHunks: 1 }] });
    useReviewStore.getState().setSinceOnly(true);
    render(<DiffViewer />);
    expect(screen.getByText(/Nothing new here since you last looked, but 1 change you saw is gone/)).toBeTruthy();
    expect(screen.getByText(/seenBefore/)).toBeTruthy();
    expect(screen.getByText(/fixedNow/)).toBeTruthy();
  });

  it("steps through only the hunks it shows while filtering", () => {
    useReviewStore.getState().setSince(since);
    useReviewStore.getState().setSinceOnly(true);
    render(<DiffViewer />);
    expect(useReviewStore.getState().hunkCount).toBe(1);
    cleanup();

    useReviewStore.getState().setSinceOnly(false);
    render(<DiffViewer />);
    expect(useReviewStore.getState().hunkCount).toBe(2);
  });

  it("has no labels once nothing is new", () => {
    render(<DiffViewer />);
    expect(screen.queryByText("New since you last looked")).toBeNull();
  });
});

describe("the banner", () => {
  it("says what changed, and toggles showing only it", () => {
    useReviewStore.getState().setSince(since);
    render(<SinceBanner />);

    expect(screen.getByRole("status", { name: "Changed since you last looked" }).textContent).toContain(
      "Changed since you last looked: 1 file +1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show only these changes" }));
    expect(useReviewStore.getState().sinceOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Show all changes" })).toBeTruthy();
  });

  it("goes to a changed file", () => {
    useReviewStore.setState({ selectedFile: null });
    useReviewStore.getState().setSince(since);
    render(<SinceBanner />);
    fireEvent.click(screen.getByRole("button", { name: "cache.ts" }));
    expect(useReviewStore.getState().selectedFile).toBe("src/cache.ts");
  });

  it("marks the round seen on the server", async () => {
    useReviewStore.getState().setSince(since);
    render(<SinceBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as seen" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:24680/api/reviews/s1/seen", expect.objectContaining({ method: "POST" })),
    );
  });

  it("says so when marking it seen fails, rather than looking stuck", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "Session not found" }), { status: 404 }));
    useReviewStore.getState().setSince(since);
    render(<SinceBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as seen" }));
    expect(await screen.findByText("Couldn't mark as seen: Session not found")).toBeTruthy();
  });

  it("counts changes that went away", () => {
    useReviewStore.getState().setSince({ files: [{ ...since.files[0], hunks: [], lines: [], additions: 0, droppedHunks: 2 }] });
    render(<SinceBanner />);
    expect(screen.getByRole("status").textContent).toContain("2 changes you saw are gone");
  });

  it("isn't there when nothing changed", () => {
    render(<SinceBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops the only-new view when the server says nothing is new any more", () => {
    useReviewStore.getState().setSince(since);
    useReviewStore.getState().setSinceOnly(true);
    useReviewStore.getState().setSince(null);
    expect(useReviewStore.getState().sinceOnly).toBe(false);
  });
});

describe("a fixed finding in the dojo", () => {
  const dojo: DojoState = {
    status: "done",
    startedAt: 1,
    finishedAt: 2,
    agents: [{ agent: { name: "claude" }, label: "Claude Code", stage: "done", stageStartedAt: 1, raised: 1 }],
    findings: [
      {
        id: "claude-1", raisedBy: "claude", file: "src/cache.ts", line: 21, side: "new", severity: "major",
        title: "Eviction never runs", body: "", votes: [], consensus: "solo", annotationId: "ann-1",
      },
    ],
  };
  const fixedThread: Annotation = {
    id: "ann-1", sessionId: "s1", file: "src/cache.ts", line: 21, side: "new", body: "[major] Eviction never runs", type: "finding",
    confidence: 1, category: "other", source: { agent: "Review dojo", tool: "dojo" }, author: "agent", createdAt: 1,
    replies: [
      { id: "r1", author: "reviewer", body: "Please fix this.", createdAt: 2 },
      { id: "r2", author: "agent", body: "Evict on write.", createdAt: 3, fixed: true },
    ],
  };
  const panel = (onNavigate = vi.fn()) =>
    render(<DojoPanel sessionId="s1" dojo={dojo} onNavigate={onNavigate} onHide={() => {}} sendBack={{ annotations: [fixedThread], agentReadAt: 4 }} />);

  it("says where to check the fix, and goes there showing only what changed", () => {
    useReviewStore.setState({ selectedFile: null });
    useReviewStore.getState().setSince(since);
    panel();

    fireEvent.click(screen.getByRole("button", { name: "Changed since you last looked: cache.ts line 22" }));

    expect(useReviewStore.getState().sinceOnly).toBe(true);
    expect(useReviewStore.getState().selectedFile).toBe("src/cache.ts");
  });

  it("keeps a working copy's staged and unstaged lines apart, and opens the copy you pick", () => {
    useReviewStore.getState().setSince({
      files: [
        { ...since.files[0], key: "staged:src/cache.ts", lines: [{ start: 10, end: 12 }] },
        { ...since.files[0], key: "unstaged:src/cache.ts", lines: [{ start: 40, end: 40 }] },
      ],
    });
    panel();

    expect(screen.getByRole("button", { name: "Changed since you last looked: cache.ts (staged) lines 10–12" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Changed since you last looked: cache.ts (unstaged) line 40" }));
    expect(useReviewStore.getState().selectedFile).toBe("unstaged:src/cache.ts");
  });

  it("counts a fix that only removed lines, or took the file out of the diff, as a change", () => {
    useReviewStore.getState().setSince({ files: [{ ...since.files[0], hunks: [], lines: [], additions: 0, droppedHunks: 1 }] });
    panel();
    expect(screen.getByRole("button", { name: "Lines removed from cache.ts since you last looked" })).toBeTruthy();
    expect(screen.queryByText(/Nothing in cache.ts changed/)).toBeNull();
    cleanup();

    useReviewStore.getState().setSince({ files: [{ ...since.files[0], status: "removed", hunks: [], lines: [], droppedHunks: 2 }] });
    panel();
    expect(screen.getByText("cache.ts left the diff since you last looked.")).toBeTruthy();
  });

  it("says so when nothing in the finding's file changed", () => {
    useReviewStore.getState().setSince({ files: [{ ...since.files[0], key: "other.ts", path: "other.ts" }] });
    panel();
    expect(screen.getByText("Nothing in cache.ts changed since you last looked.")).toBeTruthy();
  });

  it("says nothing about changes once they've been seen", () => {
    panel();
    expect(screen.queryByText(/since you last looked/)).toBeNull();
    expect(screen.getByText("Fixed by the agent")).toBeTruthy();
  });
});
