import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkoutPullRequest } from "../checkout.js";
import type { PrCheckoutRequest } from "../checkout.js";

// Real git against a local repository standing in for GitHub: what's under
// test is what lands on disk.
describe("checkoutPullRequest (#240)", () => {
  let tmp: string;
  let remote: string;
  let baseSha: string;
  let headSha: string;

  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

  function commit(file: string, content: string): string {
    fs.writeFileSync(path.join(remote, file), content);
    git(remote, "add", file);
    git(remote, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", file);
    return git(remote, "rev-parse", "HEAD");
  }

  function request(over: Partial<PrCheckoutRequest> = {}): PrCheckoutRequest {
    return {
      owner: "acme",
      repo: "widget",
      number: 7,
      headSha,
      baseSha,
      root: path.join(tmp, "repos"),
      remoteUrl: `file://${remote}`,
      token: "secret-token",
      ...over,
    };
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diffprism-checkout-"));
    remote = path.join(tmp, "remote");
    fs.mkdirSync(remote);
    git(remote, "init", "--quiet", "--initial-branch=main");
    // GitHub serves any commit by its id; a local repository has to be told to.
    git(remote, "config", "uploadpack.allowAnySHA1InWant", "true");
    baseSha = commit("a.ts", "base\n");
    // The PR's head is on no branch of the remote, as a fork's PR is.
    git(remote, "checkout", "--quiet", "--detach");
    headSha = commit("a.ts", "head\n");
    git(remote, "checkout", "--quiet", "main");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("checks the PR's head out in a worktree of its own", async () => {
    const worktree = await checkoutPullRequest(request());

    expect(worktree).toBe(path.join(tmp, "repos", "acme", "widget", "pr-7"));
    expect(fs.readFileSync(path.join(worktree, "a.ts"), "utf-8")).toBe("head\n");
    expect(git(worktree, "rev-parse", "HEAD")).toBe(headSha);
    // The base is there to read too.
    expect(git(worktree, "show", `${baseSha}:a.ts`)).toBe("base");
  });

  it("moves the worktree to the PR's new head when it's opened again", async () => {
    await checkoutPullRequest(request());
    git(remote, "checkout", "--quiet", headSha);
    const newHead = commit("a.ts", "pushed since\n");

    const worktree = await checkoutPullRequest(request({ headSha: newHead }));

    expect(fs.readFileSync(path.join(worktree, "a.ts"), "utf-8")).toBe("pushed since\n");
  });

  it("checks out two PRs of one repo opened at once", async () => {
    const [seven, eight] = await Promise.all([
      checkoutPullRequest(request()),
      checkoutPullRequest(request({ number: 8, headSha: baseSha })),
    ]);

    expect(fs.readFileSync(path.join(seven, "a.ts"), "utf-8")).toBe("head\n");
    expect(fs.readFileSync(path.join(eight, "a.ts"), "utf-8")).toBe("base\n");
  });

  it("keeps the token out of the repository", async () => {
    await checkoutPullRequest(request());

    const config = fs.readFileSync(path.join(tmp, "repos", "acme", "widget.git", "config"), "utf-8");
    expect(config).not.toContain("secret-token");
    expect(config).not.toContain(Buffer.from("x-access-token:secret-token").toString("base64"));
  });

  it("fails, and says why, when the commit can't be fetched", async () => {
    await expect(checkoutPullRequest(request({ headSha: "0".repeat(40) }))).rejects.toThrow(/^git fetch failed: /);
  });
});
