/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, renderHook, act } from "@testing-library/react";
import { DojoPanel } from "../components/DojoPanel";
import { useWebSocket } from "../hooks/useWebSocket";
import { useReviewStore } from "../store/review";
import type { Annotation, DojoCombinedFinding, DojoState } from "../types";

const finding = (over: Partial<DojoCombinedFinding>): DojoCombinedFinding => ({
  id: "claude-1",
  raisedBy: "claude",
  file: "src/cache.ts",
  line: 12,
  side: "new",
  severity: "major",
  title: "Cache never expires",
  body: "No TTL.",
  votes: [],
  consensus: "agreed",
  annotationId: "ann-1",
  ...over,
});

const done: DojoState = {
  status: "done",
  startedAt: 1,
  finishedAt: 2,
  agents: [
    { agent: { name: "claude" }, label: "Claude Code", stage: "done", stageStartedAt: 1, raised: 1 },
    {
      agent: { name: "cursor", model: "gpt-5" },
      label: "Cursor",
      stage: "dropped",
      stageStartedAt: 2,
      raised: 1,
      error: "couldn't vote: didn't answer with a JSON block.",
    },
  ],
  findings: [
    finding({ votes: [{ agent: "cursor", stance: "agree", severity: "critical", note: "and it grows forever" }] }),
    finding({
      id: "cursor-1",
      raisedBy: "cursor",
      title: "Retry loop has no cap",
      consensus: "disputed",
      votes: [{ agent: "claude", stance: "disagree", severity: "nit", note: "bounded by the caller" }],
      annotationId: "ann-2",
    }),
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.pushState({}, "", "/?httpPort=24680");
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/dojo/agents")) {
      return new Response(JSON.stringify({ agents: [{ name: "claude", label: "Claude Code" }, { name: "cursor", label: "Cursor", model: "gpt-5" }] }));
    }
    if (url.endsWith("/dojo") && init?.method === "POST") return new Response("{}", { status: 202 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DojoPanel (#231)", () => {
  it("offers the installed agents, all chosen, and starts the dojo with the ones left ticked", async () => {
    render(<DojoPanel sessionId="s1" dojo={null} onNavigate={() => {}} onHide={() => {}} />);

    const cursor = (await screen.findByRole("checkbox", { name: /Cursor/ })) as HTMLInputElement;
    expect((screen.getByRole("checkbox", { name: /Claude Code/ }) as HTMLInputElement).checked).toBe(true);
    expect(cursor.checked).toBe(true);
    expect(screen.getByText("gpt-5")).toBeTruthy();

    fireEvent.click(cursor);
    fireEvent.click(screen.getByRole("button", { name: /Start the dojo/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:24680/api/reviews/s1/dojo",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ agents: ["claude"] }) }),
      ),
    );
  });

  it("shows findings by agreement, with who raised each and how the others voted", () => {
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} />);

    const agreed = screen.getByRole("region", { name: "Agreed" });
    expect(within(agreed).getByText("Cache never expires")).toBeTruthy();
    expect(within(agreed).getByText("Raised by Claude Code")).toBeTruthy();
    expect(agreed.textContent).toContain("Cursor agrees (critical): and it grows forever");

    const disputed = screen.getByRole("region", { name: "Disputed" });
    expect(disputed.textContent).toContain("Claude Code disagrees (nit): bounded by the caller");
    expect(screen.queryByRole("region", { name: "One reviewer" })).toBeNull();
  });

  it("says which agent dropped out, and why", () => {
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.getByText(/Cursor couldn't vote: didn't answer with a JSON block/)).toBeTruthy();
  });

  it("goes to a finding's thread when it's clicked", () => {
    const onNavigate = vi.fn();
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={onNavigate} onHide={() => {}} />);
    fireEvent.click(screen.getByText("Retry loop has no cap"));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "cursor-1", annotationId: "ann-2" }));
  });

  it("says why a dojo failed, and offers to run it again", async () => {
    const failed: DojoState = { status: "failed", startedAt: 1, agents: [], findings: [], error: "No agent could review." };
    render(<DojoPanel sessionId="s1" dojo={failed} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.getByText("The last dojo failed: No agent could review.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Start the dojo/ })).toBeTruthy();
  });

  it("says the agents are starting before any has reported", () => {
    render(<DojoPanel sessionId="s1" dojo={{ status: "running", startedAt: Date.now(), agents: [], findings: [] }} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.getByText("Starting the agents…")).toBeTruthy();
  });

  describe("each agent's own times (#272)", () => {
    it("fixes a finished agent's review time while it waits for the others", () => {
      const running: DojoState = {
        status: "running",
        startedAt: Date.now(),
        findings: [],
        agents: [
          { agent: { name: "claude" }, label: "Claude Code", stage: "waiting", stageStartedAt: Date.now(), raised: 2, reviewedInMs: 51_000 },
          { agent: { name: "cursor" }, label: "Cursor", stage: "reviewing", stageStartedAt: Date.now() },
        ],
      };
      render(<DojoPanel sessionId="s1" dojo={running} onNavigate={() => {}} onHide={() => {}} />);
      expect(screen.getByLabelText("Claude Code").textContent).toContain("Waiting for Cursor · raised 2 · reviewed in 0:51");
    });

    it("lists each agent's times, with the model it ran on", () => {
      const timed: DojoState = {
        ...done,
        agents: [
          { agent: { name: "claude" }, label: "Claude Code", stage: "done", stageStartedAt: 1, raised: 1, reviewedInMs: 51_000, votedInMs: 20_000 },
          { agent: { name: "cursor", model: "gpt-5.3-codex" }, label: "Cursor", stage: "done", stageStartedAt: 1, raised: 1, reviewedInMs: 372_000, votedInMs: 65_000 },
        ],
      };
      render(<DojoPanel sessionId="s1" dojo={timed} onNavigate={() => {}} onHide={() => {}} />);
      const times = screen.getByRole("list", { name: "Agent times" });
      expect(times.textContent).toContain("Claude Code · default model — reviewed in 0:51, voted in 0:20");
      expect(times.textContent).toContain("Cursor · gpt-5.3-codex — reviewed in 6:12, voted in 1:05");
    });
  });

  describe("while it runs (#251, #252)", () => {
    const running = (agents: DojoState["agents"]): DojoState => ({ status: "running", startedAt: Date.now(), agents, findings: [] });

    it("says an agent whose review is in is waiting for the others, by name", () => {
      render(
        <DojoPanel
          sessionId="s1"
          dojo={running([
            { agent: { name: "claude" }, label: "Claude Code", stage: "waiting", stageStartedAt: Date.now(), raised: 5 },
            { agent: { name: "cursor" }, label: "Cursor", stage: "reviewing", stageStartedAt: Date.now(), activity: "Thinking" },
          ])}
          onNavigate={() => {}}
          onHide={() => {}}
        />,
      );
      const claude = screen.getByLabelText("Claude Code");
      expect(claude.textContent).toContain("Waiting for Cursor · raised 5");
      // Idle, not working: no spinner.
      expect(within(claude).getByLabelText("waiting")).toBeTruthy();
    });

    it("says it's waiting to vote once nobody is left reviewing", () => {
      render(
        <DojoPanel
          sessionId="s1"
          dojo={running([{ agent: { name: "claude" }, label: "Claude Code", stage: "waiting", stageStartedAt: Date.now(), raised: 1 }])}
          onNavigate={() => {}}
          onHide={() => {}}
        />,
      );
      expect(screen.getByLabelText("Claude Code").textContent).toContain("Waiting to vote");
    });

    it("stops the dojo", async () => {
      fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
      render(<DojoPanel sessionId="s1" dojo={running([])} onNavigate={() => {}} onHide={() => {}} />);

      fireEvent.click(screen.getByRole("button", { name: /Stop/ }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith("http://localhost:24680/api/reviews/s1/dojo/stop", expect.objectContaining({ method: "POST" })),
      );
      expect(screen.getByRole("button", { name: /Stopping/ })).toBeTruthy();
    });

    it("says why when it couldn't stop", async () => {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "No dojo is running on this review." }), { status: 409 }));
      render(<DojoPanel sessionId="s1" dojo={running([])} onNavigate={() => {}} onHide={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
      expect(await screen.findByText("No dojo is running on this review.")).toBeTruthy();
    });

    it("once stopped, says why and offers to run it again", async () => {
      const stopped: DojoState = { status: "stopped", startedAt: 1, finishedAt: 2, agents: [], findings: [], error: "Stopped: the review was decided." };
      render(<DojoPanel sessionId="s1" dojo={stopped} onNavigate={() => {}} onHide={() => {}} />);
      expect(screen.getByText("The last dojo was stopped. Stopped: the review was decided.")).toBeTruthy();
      expect(await screen.findByRole("button", { name: /Start the dojo/ })).toBeTruthy();
    });
  });

  it("shows what each agent is doing, and for how long, while the dojo runs", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(100_000);
      const running: DojoState = {
        status: "running",
        startedAt: 100_000 - 75_000,
        findings: [],
        agents: [
          { agent: { name: "claude" }, label: "Claude Code", stage: "voting", stageStartedAt: 100_000 - 12_000, raised: 3, activity: "Reading src/retry.ts" },
          { agent: { name: "cursor" }, label: "Cursor", stage: "dropped", stageStartedAt: 90_000, error: "couldn't start: Cursor isn't logged in." },
        ],
      };
      render(<DojoPanel sessionId="s1" dojo={running} onNavigate={() => {}} onHide={() => {}} />);

      expect(screen.getByText("1:15")).toBeTruthy();
      const claude = screen.getByLabelText("Claude Code");
      expect(claude.textContent).toContain("Voting on the others' findings · raised 3");
      expect(claude.textContent).toContain("Reading src/retry.ts");
      expect(claude.textContent).toContain("0:12");
      expect(screen.getByLabelText("Cursor").textContent).toContain("couldn't start: Cursor isn't logged in.");

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(claude.textContent).toContain("0:15");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dojo:update", () => {
  class FakeSocket {
    static last: FakeSocket;
    private listeners: Record<string, ((e: { data?: string }) => void)[]> = {};
    constructor(public url: string) {
      FakeSocket.last = this;
    }
    addEventListener(type: string, fn: (e: { data?: string }) => void) {
      (this.listeners[type] ??= []).push(fn);
    }
    send() {}
    close() {}
    emit(type: string, data?: unknown) {
      for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) });
    }
  }

  it("puts the dojo in the store, and a new review starts without one", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    window.history.replaceState(null, "", "/?wsPort=1&httpPort=2&serverMode=true");
    renderHook(() => useWebSocket());

    act(() => FakeSocket.last.emit("message", { type: "dojo:update", payload: done }));
    expect(useReviewStore.getState().dojo).toEqual(done);

    act(() =>
      FakeSocket.last.emit("message", {
        type: "review:init",
        payload: { reviewId: "s2", diffSet: { baseRef: "a", headRef: "b", files: [] }, rawDiff: "", briefing: null, metadata: {} },
      }),
    );
    expect(useReviewStore.getState().dojo).toBeNull();
  });
});

describe("sending findings to the agent that made the change (#238)", () => {
  const thread = (id: string, over: Partial<Annotation> = {}): Annotation => ({
    id, sessionId: "s1", file: "src/cache.ts", line: 12, side: "new", type: "finding", confidence: 1, category: "other",
    source: { agent: "Review dojo", tool: "dojo" }, author: "agent", createdAt: 1, replies: [],
    body: `[major] opening of ${id}`,
    ...over,
  });

  beforeEach(() => {
    useReviewStore.setState({ comments: [] });
  });

  it("has no send actions on a PR review, whose decision goes to GitHub", () => {
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.queryByRole("button", { name: /Send to the agent/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // …and says why, so their absence doesn't look like a bug (#254).
    expect(screen.getByText(/On a pull request, these findings stay here unless you post one/)).toBeDefined();
  });

  it("puts a finding on the pull request when the reviewer posts it, and says where it went (#289)", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ url: "https://github.com/acme/widget/pull/7#discussion_r1" })));
    const { rerender } = render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Post to GitHub" })[0]);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:24680/api/reviews/s1/dojo/findings/claude-1/github",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // Its link arrives with the dojo's next update.
    const posted = { ...done, findings: [{ ...done.findings[0], githubCommentUrl: "https://github.com/acme/widget/pull/7#discussion_r1" }, done.findings[1]] };
    rerender(<DojoPanel sessionId="s1" dojo={posted} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.getByRole("link", { name: /On the pull request/ }).getAttribute("href")).toBe("https://github.com/acme/widget/pull/7#discussion_r1");
    expect(screen.getAllByRole("button", { name: "Post to GitHub" })).toHaveLength(1);
  });

  it("says why when GitHub won't take it", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "GitHub didn't take the comment: line must be part of the diff" }), { status: 502 }));
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Post to GitHub" })[0]);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "GitHub didn't take the comment: line must be part of the diff");
  });

  it("says which skills the agents reviewed by (#290)", () => {
    render(<DojoPanel sessionId="s1" dojo={{ ...done, skills: ["Security review", "house-style"] }} onNavigate={() => {}} onHide={() => {}} />);
    expect(screen.getByText(/Reviewing by the skills/).textContent).toBe("Reviewing by the skills Security review, house-style.");
  });

  it("offers no Post to GitHub on a local review", () => {
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} sendBack={{ annotations: [], agentReadAt: undefined }} />);
    expect(screen.queryByRole("button", { name: "Post to GitHub" })).toBeNull();
  });

  it("ticks the agreed findings, and sends them to the agent to fix on their threads", async () => {
    const sendBack = { annotations: [thread("ann-1"), thread("ann-2")], agentReadAt: undefined };
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} sendBack={sendBack} />);

    expect((screen.getByRole("checkbox", { name: /Cache never expires/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Retry loop has no cap/ }) as HTMLInputElement).checked).toBe(false);

    fetchMock.mockImplementation(async () => new Response("{}", { status: 201 }));
    fireEvent.click(screen.getByRole("button", { name: "Send to the agent to fix (1)" }));

    await screen.findByText(/Sent 1 finding to the agent/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:24680/api/reviews/s1/annotations/ann-1/replies");
    expect(JSON.parse(String(init.body))).toEqual({ author: "reviewer", body: "Please fix this, or reply to say why it isn't a problem." });
  });

  it("has one way to send findings, so each can be followed — none into the request for changes (#256)", () => {
    const sendBack = { annotations: [thread("ann-1"), thread("ann-2")], agentReadAt: undefined };
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} sendBack={sendBack} />);
    expect(screen.queryByRole("button", { name: /request for changes/i })).toBeNull();
    expect(useReviewStore.getState().comments).toEqual([]);
  });

  it("says on each card whether the agent has the finding, and when it has answered", () => {
    const asked = thread("ann-1", { replies: [{ id: "r1", author: "reviewer", body: "Please fix this.", createdAt: 10 }] });
    const answered = thread("ann-2", {
      replies: [
        { id: "r1", author: "reviewer", body: "Please fix this.", createdAt: 10 },
        { id: "r2", author: "agent", body: "Fixed.", createdAt: 20 },
      ],
    });
    render(
      <DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} sendBack={{ annotations: [asked, answered], agentReadAt: 30 }} />,
    );

    expect(screen.getByText("Sent to the agent — it has it")).toBeTruthy();
    expect(screen.getByText("The agent answered — see the thread")).toBeTruthy();
    // Already asked, so neither is ticked to send again.
    expect(screen.getAllByRole("checkbox").every((c) => !(c as HTMLInputElement).checked)).toBe(true);
  });

  // ─── #256: fixed in place, and dismissed ───

  /** The panel as ReviewView mounts it: fed the store's threads, so a dismissal shows. */
  function LocalPanel() {
    const annotations = useReviewStore((s) => s.annotations);
    return <DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} sendBack={{ annotations, agentReadAt: 30 }} />;
  }

  it("shows a finding the agent fixed as fixed, with what it says it changed", () => {
    const fixed = thread("ann-1", {
      replies: [
        { id: "r1", author: "reviewer", body: "Please fix this.", createdAt: 10 },
        { id: "r2", author: "agent", body: "Added a 5 minute TTL.", createdAt: 20, fixed: true },
      ],
    });
    render(<DojoPanel sessionId="s1" dojo={done} onNavigate={() => {}} onHide={() => {}} sendBack={{ annotations: [fixed, thread("ann-2")], agentReadAt: 30 }} />);

    expect(screen.getByText("Fixed by the agent")).toBeTruthy();
    expect(screen.getByText(/Added a 5 minute TTL\./)).toBeTruthy();
    expect(screen.queryByText("The agent answered — see the thread")).toBeNull();
    // Fixed, so it isn't ticked to send again — but asking about it again is still possible.
    const box = screen.getByRole("checkbox", { name: /Cache never expires/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(screen.getByRole("button", { name: "Send to the agent to fix (1)" })).toBeTruthy();
  });

  it("dismisses a finding's thread, and a dismissed finding can't be sent", async () => {
    useReviewStore.setState({ reviewId: "s1", annotations: [thread("ann-1"), thread("ann-2")] });
    render(<LocalPanel />);

    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:24680/api/reviews/s1/annotations/ann-1/dismiss", { method: "POST" }),
    );
    expect(screen.getByText("Dismissed")).toBeTruthy();
    const box = screen.getByRole("checkbox", { name: /Cache never expires/ }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(screen.getByRole("button", { name: "Send to the agent to fix (0)" })).toBeTruthy();
    // The other finding can still be dismissed.
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
  });
});
