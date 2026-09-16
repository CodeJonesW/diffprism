/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PrReviewBar } from "../components/ActionBar";
import { useReviewStore } from "../store/review";
import type { Annotation } from "../types";

function thread(over: Partial<Annotation>): Annotation {
  return {
    id: "t", sessionId: "s1", file: "src/cache.ts", line: 4, side: "new", body: "Why lazily?", type: "question",
    confidence: 1, category: "other", source: { agent: "reviewer" }, createdAt: 1, author: "reviewer", ...over,
  };
}

const PR = {
  owner: "acme", repo: "widget", number: 7, title: "t", author: "a",
  url: "https://github.com/acme/widget/pull/7", baseBranch: "main", headBranch: "f",
};

describe("PrReviewBar", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    window.history.replaceState(null, "", "/?httpPort=2");
    useReviewStore.setState({
      reviewId: "s1",
      metadata: { title: "t", githubPr: PR },
      annotations: [
        thread({ id: "mine", body: "Why lazily?" }),
        thread({ id: "gone", body: "Dismissed one", dismissed: true }),
        thread({ id: "agent", body: "Agent finding", author: "agent" }),
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it("needs a summary before it can request changes or comment", () => {
    render(<PrReviewBar />);
    expect(screen.getByRole("button", { name: "Request changes" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Comment" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByPlaceholderText(/Summary/), { target: { value: "Stale cache" } });
    expect(screen.getByRole("button", { name: "Request changes" })).toHaveProperty("disabled", false);
  });

  it("offers only your open threads, and posts none unless picked", async () => {
    respond(200, { url: "https://github.com/acme/widget/pull/7#pullrequestreview-1" });
    render(<PrReviewBar />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:2/api/reviews/s1/github-review");
    expect(sent()).toEqual({ event: "APPROVE", threadIds: [] });
  });

  it("posts the picked threads with the decision and links to the posted review", async () => {
    respond(200, { url: "https://github.com/acme/widget/pull/7#pullrequestreview-1" });
    render(<PrReviewBar />);

    fireEvent.change(screen.getByPlaceholderText(/Summary/), { target: { value: "Stale cache" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));

    const link = await screen.findByRole("link", { name: /View on GitHub/ });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/widget/pull/7#pullrequestreview-1");
    expect(sent()).toEqual({ event: "REQUEST_CHANGES", summary: "Stale cache", threadIds: ["mine"] });
  });

  it("shows GitHub's refusal and keeps what the reviewer wrote", async () => {
    respond(502, { error: "GitHub rejected the review: Can not approve your own pull request" });
    render(<PrReviewBar />);

    fireEvent.change(screen.getByPlaceholderText(/Summary/), { target: { value: "LGTM" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Can not approve your own pull request");
    expect((screen.getByPlaceholderText(/Summary/) as HTMLTextAreaElement).value).toBe("LGTM");
    expect(screen.queryByRole("link", { name: /View on GitHub/ })).toBeNull();
  });
});
