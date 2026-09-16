import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ISSUES_NEW_URL,
  buildFeedbackUrl,
  describeEnvironment,
  readLastError,
  recordError,
  redactHome,
} from "../feedback.js";
import type { Environment } from "../feedback.js";

const env: Environment = { version: "1.2.3", build: "release", os: "Darwin 25.5.0 (arm64)", node: "v22.0.0" };

function parse(url: string) {
  const parsed = new URL(url);
  return {
    base: `${parsed.origin}${parsed.pathname}`,
    title: parsed.searchParams.get("title") ?? "",
    body: parsed.searchParams.get("body") ?? "",
    labels: parsed.searchParams.get("labels") ?? "",
  };
}

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dp-feedback-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("where reports go", () => {
  it("points at this repository's issues", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../../../package.json"), "utf8"),
    ) as { repository: { url: string } };
    const repo = manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
    expect(ISSUES_NEW_URL).toBe(`${repo}/issues/new`);
  });
});

describe("buildFeedbackUrl", () => {
  it("prefills feedback with the message and environment", () => {
    const { base, title, body, labels } = parse(
      buildFeedbackUrl({ kind: "feedback", message: "Love the hook", environment: env }),
    );
    expect(base).toBe(ISSUES_NEW_URL);
    expect(labels).toBe("feedback");
    expect(title).toBe("Feedback: Love the hook");
    expect(body).toContain("Love the hook");
    expect(body).toContain("1.2.3 (release)");
    expect(body).toContain("v22.0.0");
  });

  it("prefills a bug with the last error", () => {
    const { title, body, labels } = parse(
      buildFeedbackUrl({
        kind: "bug",
        error: { command: "review", message: "Server failed to start", at: "2026-09-16T00:00:00Z" },
        environment: env,
      }),
    );
    expect(labels).toBe("bug");
    expect(title).toBe("Bug: Server failed to start");
    expect(body).toContain("`diffprism review`");
    expect(body).toContain("Server failed to start");
  });

  it("never attaches an error to plain feedback", () => {
    const { body } = parse(
      buildFeedbackUrl({
        kind: "feedback",
        error: { command: "review", message: "secret-looking failure", at: "x" },
        environment: env,
      }),
    );
    expect(body).not.toContain("secret-looking failure");
  });

  it("replaces the home directory so a report doesn't carry a username", () => {
    const { title, body } = parse(
      buildFeedbackUrl({
        kind: "bug",
        error: { command: "review", message: `Cannot find module '${home}/dev/app/diffprism'`, at: "x" },
        environment: env,
      }),
    );
    expect(body).not.toContain(home);
    expect(body).toContain("~/dev/app/diffprism");
    expect(title).not.toContain(home);
  });

  it("keeps a long error inside GitHub's URL limit", () => {
    const url = buildFeedbackUrl({
      kind: "bug",
      error: { command: "review", message: "x".repeat(20_000), at: "x" },
      environment: env,
    });
    expect(url.length).toBeLessThan(8_000);
    expect(parse(url).body).toContain("(truncated)");
  });

  it("reminds the user they're reviewing it before anything is shared", () => {
    expect(parse(buildFeedbackUrl({ kind: "feedback", environment: env })).body).toContain(
      "visible before you submit",
    );
  });
});

describe("describeEnvironment", () => {
  it("says whether it is a dev build without saying where the checkout is", () => {
    const described = describeEnvironment();
    expect(["release", "dev build"]).toContain(described.build);
    expect(JSON.stringify(described)).not.toContain("/diffprism-projects/");
  });
});

describe("the last error", () => {
  it("is kept on this machine for a later bug report", () => {
    recordError("hook pre-commit", new Error("could not read the staged diff"));
    expect(readLastError()).toMatchObject({
      command: "hook pre-commit",
      message: "could not read the staged diff",
    });
  });

  it("is empty until something fails", () => {
    expect(readLastError()).toBeNull();
  });

  it("never replaces the error being reported when it can't be saved", () => {
    // A file where the .diffprism directory should be makes the write fail.
    fs.writeFileSync(path.join(home, ".diffprism"), "not a directory");
    expect(() => recordError("review", new Error("the real problem"))).not.toThrow();
  });
});

describe("redactHome", () => {
  it("leaves text without the home directory alone", () => {
    expect(redactHome("/tmp/elsewhere")).toBe("/tmp/elsewhere");
  });
});
