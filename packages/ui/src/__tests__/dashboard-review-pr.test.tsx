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
