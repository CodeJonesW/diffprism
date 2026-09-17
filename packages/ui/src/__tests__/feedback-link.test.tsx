/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { FeedbackLink } from "../components/FeedbackLink";

beforeEach(() => {
  window.history.pushState({}, "", "/?httpPort=24680");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FeedbackLink", () => {
  it("links to the prefilled issue the server builds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ url: "https://github.com/x/y/issues/new?title=Feedback" }) })));

    render(<FeedbackLink />);

    const link = (await screen.findByText("Send feedback")).closest("a")!;
    expect(link.getAttribute("href")).toBe("https://github.com/x/y/issues/new?title=Feedback");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renders nothing when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<FeedbackLink />);
    await waitFor(() => expect(screen.queryByText("Send feedback")).toBeNull());
  });
});
