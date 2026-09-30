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

  // ─── #257 ───

  it("keeps the PR's commits in refs of its own, so gc can't prune them", async () => {
    await checkoutPullRequest(request());
    const repoDir = path.join(tmp, "repos", "acme", "widget.git");
    expect(git(repoDir, "rev-parse", "refs/diffprism/pr-7/head")).toBe(headSha);
    expect(git(repoDir, "rev-parse", "refs/diffprism/pr-7/base")).toBe(baseSha);
  });

  describe("apart from the reviewer's own git config", () => {
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.GIT_CONFIG_GLOBAL;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = saved;
    });

    it("isn't redirected by a URL rewrite, and runs none of their filters", async () => {
      // The PR's files ask for a filter, and the reviewer's config has one —
      // along with a rewrite that would send the fetch, and its token, elsewhere.
      git(remote, "checkout", "--quiet", headSha);
      fs.writeFileSync(path.join(remote, ".gitattributes"), "* filter=spy\n");
      const filtered = commit(".gitattributes", "* filter=spy\n");
      git(remote, "checkout", "--quiet", "main");
      const marker = path.join(tmp, "filter-ran");
      const global = path.join(tmp, "global-gitconfig");
      fs.writeFileSync(
        global,
        `[url "file://${path.join(tmp, "elsewhere")}"]\n\tinsteadOf = file://${remote}\n[filter "spy"]\n\tsmudge = "touch ${marker}; cat"\n`,
      );
      process.env.GIT_CONFIG_GLOBAL = global;

      const worktree = await checkoutPullRequest(request({ headSha: filtered }));

      expect(git(worktree, "rev-parse", "HEAD")).toBe(filtered);
      expect(fs.existsSync(marker)).toBe(false);
    });
  });

  it("makes the repository and the worktree again when their folders aren't what they should be", async () => {
    // Left by an init and an add that failed partway.
    const repoDir = path.join(tmp, "repos", "acme", "widget.git");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, "junk"), "");
    const stale = path.join(tmp, "repos", "acme", "widget", "pr-7");
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, "a.ts"), "not a checkout\n");

    const worktree = await checkoutPullRequest(request());

    expect(git(worktree, "rev-parse", "HEAD")).toBe(headSha);
    expect(fs.readFileSync(path.join(worktree, "a.ts"), "utf-8")).toBe("head\n");
  });

  it("keeps a repository that is one, and says why when git fails there, rather than deleting it", async () => {
    await checkoutPullRequest(request());
    const repoDir = path.join(tmp, "repos", "acme", "widget.git");
    const objects = fs.readdirSync(path.join(repoDir, "objects")).length;

    // A commit the remote doesn't have: git fails, with the repository fine.
    await expect(checkoutPullRequest(request({ number: 8, headSha: "1".repeat(40) }))).rejects.toThrow(/^git fetch failed: /);

    expect(fs.readdirSync(path.join(repoDir, "objects")).length).toBe(objects);
    expect(git(repoDir, "rev-parse", "refs/diffprism/pr-7/head")).toBe(headSha);
  });

  it("leaves exactly the PR's head, whatever was left in the folder", async () => {
    const worktree = await checkoutPullRequest(request());
    fs.writeFileSync(path.join(worktree, "a.ts"), "edited\n");
    fs.writeFileSync(path.join(worktree, "stray.ts"), "left behind\n");

    await checkoutPullRequest(request());

    expect(fs.readFileSync(path.join(worktree, "a.ts"), "utf-8")).toBe("head\n");
    expect(fs.existsSync(path.join(worktree, "stray.ts"))).toBe(false);
  });

  it("refuses an owner or repo that isn't a plain name", async () => {
    await expect(checkoutPullRequest(request({ owner: ".." }))).rejects.toThrow("Not a GitHub owner name");
    await expect(checkoutPullRequest(request({ repo: "widget/../../x" }))).rejects.toThrow("Not a GitHub repo name");
  });
});
