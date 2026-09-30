import { describe, it, expect, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { fetchPullRequest, parsePrRef } from "../client.js";

describe("parsePrRef", () => {
  it("parses owner/repo#number shorthand", () => {
    expect(parsePrRef("anthropics/diffprism#42")).toEqual({
      owner: "anthropics",
      repo: "diffprism",
      number: 42,
    });
  });

  it("parses HTTPS GitHub URL", () => {
    expect(
      parsePrRef("https://github.com/anthropics/diffprism/pull/123"),
    ).toEqual({
      owner: "anthropics",
      repo: "diffprism",
      number: 123,
    });
  });

  it("parses URL with trailing path segments", () => {
    expect(
      parsePrRef("https://github.com/owner/repo/pull/99/files"),
    ).toEqual({
      owner: "owner",
      repo: "repo",
      number: 99,
    });
  });

  it("handles repos with hyphens and dots", () => {
    expect(parsePrRef("my-org/my.repo#7")).toEqual({
      owner: "my-org",
      repo: "my.repo",
      number: 7,
    });
  });

  it("throws on invalid input", () => {
    expect(() => parsePrRef("not-a-pr-ref")).toThrow("Invalid PR reference");
  });

  it("throws on empty string", () => {
    expect(() => parsePrRef("")).toThrow("Invalid PR reference");
  });

  it("throws on malformed shorthand (missing #)", () => {
    expect(() => parsePrRef("owner/repo/123")).toThrow("Invalid PR reference");
  });
});

describe("fetchPullRequest", () => {
  const pull = {
    title: "Add widget", user: { login: "octocat" }, html_url: "https://github.com/Acme/Widget/pull/7",
    base: { ref: "main", sha: "base-tip", repo: { name: "Widget", owner: { login: "Acme" } } },
    head: { ref: "feature", sha: "head-sha" },
    body: null,
  };
  const compare = vi.fn(async () => ({ data: { merge_base_commit: { sha: "merge-base" } } }));

  /** Just the calls fetchPullRequest makes. */
  function fakeClient(getAuthenticated: () => Promise<unknown>): Octokit {
    return {
      pulls: { get: async () => ({ data: pull }) },
      repos: { compareCommitsWithBasehead: compare },
      users: { getAuthenticated },
    } as unknown as Octokit;
  }

  it("measures the PR from its merge base, and names the repo as GitHub does (#257)", async () => {
    // Typed in lower case; the base branch has moved on since the PR branched.
    const pr = await fetchPullRequest(fakeClient(async () => ({ data: { login: "cj" } })), "acme", "widget", 7);
    expect(pr).toMatchObject({ owner: "Acme", repo: "Widget", headSha: "head-sha", baseSha: "merge-base" });
    expect(compare).toHaveBeenCalledWith(expect.objectContaining({ owner: "Acme", repo: "Widget", basehead: "base-tip...head-sha" }));
  });

  it("says why when GitHub can't compare the PR", async () => {
    compare.mockRejectedValueOnce(new Error("Server Error: this diff is taking too long to generate"));
    await expect(fetchPullRequest(fakeClient(async () => ({ data: { login: "cj" } })), "acme", "widget", 7)).rejects.toThrow(
      "GitHub couldn't say where Acme/Widget#7 branched off main: Server Error: this diff is taking too long to generate",
    );
  });

  it("says who the token belongs to, so an author's own PR can be recognized (#191)", async () => {
    const pr = await fetchPullRequest(fakeClient(async () => ({ data: { login: "cj" } })), "acme", "widget", 7);
    expect(pr).toMatchObject({ author: "octocat", viewer: "cj" });
  });

  it("names no one when the token has no user behind it", async () => {
    // An Actions or GitHub App token: GitHub answers /user with 403.
    const noUser = Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
    const pr = await fetchPullRequest(fakeClient(async () => { throw noUser; }), "acme", "widget", 7);
    expect(pr.viewer).toBeNull();
  });

  it("still fails on any other error", async () => {
    const outage = Object.assign(new Error("Server Error"), { status: 500 });
    await expect(fetchPullRequest(fakeClient(async () => { throw outage; }), "acme", "widget", 7)).rejects.toThrow("Server Error");
  });
});
