/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Dashboard } from "../components/Dashboard/Dashboard";
import { useReviewStore } from "../store/review";

beforeEach(() => {
  window.history.pushState({}, "", "/?httpPort=24680");
  // Mantine reads color scheme and breakpoints through matchMedia; jsdom has none.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/pr/open")) {
        return { ok: true, json: async () => ({ sessionId: "pr-session-1" }) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useReviewStore.getState().setPane("dashboard-sessions", { collapsed: false });
});

describe("Dashboard Review PR (#228)", () => {
  it("opens the review it just started, with the sidebar hidden", async () => {
    useReviewStore.getState().setPane("dashboard-sessions", { collapsed: true });
    const onSelectSession = vi.fn();
    render(
      <MantineProvider>
        <Dashboard
          sessions={[]}
          activeSessionId={null}
          hasDiffLoaded={false}
          onSelectSession={onSelectSession}
          onCloseSession={() => {}}
          onSubmit={() => {}}
          onDismiss={() => {}}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review PR" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/owner/repo/pull/123"), {
      target: { value: "https://github.com/owner/repo/pull/7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review PR" }));

    await waitFor(() => expect(onSelectSession).toHaveBeenCalledWith("pr-session-1"));
    expect(useReviewStore.getState().panes["dashboard-sessions"].collapsed).toBe(true);
  });
});

describe("Review PR and Open project over an open review (#281)", () => {
  const session = {
    id: "s1", projectPath: "/work/app", title: "Pre-commit review", fileCount: 1, additions: 1, deletions: 0,
    status: "in_review" as const, createdAt: Date.now(),
  };

  function renderWithReviewOpen(onSelectSession = vi.fn()) {
    render(
      <MantineProvider>
        <Dashboard
          sessions={[session, { ...session, id: "s2", title: "Another review" }]}
          activeSessionId="s1"
          hasDiffLoaded={true}
          onSelectSession={onSelectSession}
          onCloseSession={() => {}}
          onSubmit={() => {}}
          onDismiss={() => {}}
        />
      </MantineProvider>,
    );
    return onSelectSession;
  }

  it("shows the form in place of the review, and a session click goes back to it", () => {
    const onSelectSession = renderWithReviewOpen();

    fireEvent.click(screen.getByTitle("Review GitHub PR"));
    expect(screen.getByRole("heading", { name: "Review PR" })).toBeTruthy();

    // The review it was on is one click away. Clicking it only closes the
    // form: selecting it again would reset its drafts with a fresh review:init.
    fireEvent.click(screen.getByText("Pre-commit review"));
    expect(screen.queryByRole("heading", { name: "Review PR" })).toBeNull();
    expect(onSelectSession).not.toHaveBeenCalled();

    // Another session is selected as usual.
    fireEvent.click(screen.getByTitle("Review GitHub PR"));
    fireEvent.click(screen.getByText("Another review"));
    expect(onSelectSession).toHaveBeenCalledWith("s2");
  });

  it("keeps the hidden review's keyboard shortcuts off while a form covers it", () => {
    useReviewStore.setState({ showHotkeyGuide: false });
    renderWithReviewOpen();

    fireEvent.click(screen.getByTitle("Open project"));
    fireEvent.keyDown(document.body, { key: "?" });
    expect(useReviewStore.getState().showHotkeyGuide).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document.body, { key: "?" });
    expect(useReviewStore.getState().showHotkeyGuide).toBe(true);
    useReviewStore.setState({ showHotkeyGuide: false });
  });

  it("does the same for Open project", () => {
    renderWithReviewOpen();
    fireEvent.click(screen.getByTitle("Open project"));
    expect(screen.getByRole("heading", { name: "Open Project" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Open Project" })).toBeNull();
  });
});
