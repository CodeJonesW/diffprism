import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Only what decides the server's fate is faked; the installers run for real
// against a temporary home and repository.
vi.mock("@diffprism/core", async () => {
  const actual = await vi.importActual<typeof import("@diffprism/core")>("@diffprism/core");
  return { ...actual, builtAt: vi.fn(() => null), ensureServer: vi.fn() };
});

import { builtAt, ensureServer } from "@diffprism/core";
import { diagnose, doctor } from "../commands/doctor.js";
import type { DoctorReport } from "../commands/doctor.js";

let home: string;
let repo: string;

function states(report: DoctorReport): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of [report.global, report.project, report.server]) {
    for (const check of section.checks) out[`${section.title.split(" ")[0]}:${check.name}`] = check.state;
  }
  return out;
}

function writeServerFile(info: Record<string, unknown>): void {
  fs.mkdirSync(path.join(home, ".diffprism"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".diffprism", "server.json"),
    JSON.stringify({ httpPort: 24680, wsPort: 24681, pid: process.pid, startedAt: Date.now(), ...info }),
  );
}

/**
 * A server that answers: /api/status says it's up, /api/reviews lists these
 * sessions. Tests without one get a fetch that fails, so none of them can reach
 * a real DiffPrism server on this machine's default port.
 */
function stubServer(sessions: Array<{ status: string }> = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.endsWith("/api/reviews") ? { sessions } : { running: true }),
    })),
  );
}

function hookFile(): string {
  return path.join(repo, ".git", "hooks", "pre-commit");
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-home-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  // An existing .gitignore, so a real setup never stops to ask about one.
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\n");
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.spyOn(process, "cwd").mockReturnValue(repo);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("tests don't talk to a real server");
  }));
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(builtAt).mockReturnValue(null);
  vi.mocked(ensureServer).mockReset();
  process.exitCode = undefined;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("diffprism doctor (#214)", () => {
  it("reports a machine with nothing installed, and writes nothing", async () => {
    const report = await diagnose(repo);

    expect(states(report)).toEqual({
      "Global:/review skill": "fixable",
      "Global:permissions": "fixable",
      "Project:.gitignore": "fixable",
      "Project:.mcp.json": "fixable",
      "Project:permissions": "fixable",
      "Project:/review skill": "fixable",
      "Project:pre-commit hook": "info",
      "Server:server": "info",
    });
    expect(fs.existsSync(path.join(home, ".claude"))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".mcp.json"))).toBe(false);
  });

  it("exits non-zero while anything is out of date", async () => {
    await doctor();
    expect(process.exitCode).toBe(1);
  });

  it("--fix installs what setup would, and then everything matches", async () => {
    await doctor({ fix: true });

    const report = await diagnose(repo);
    const failing = Object.entries(states(report)).filter(([, s]) => s === "fixable" || s === "stale");
    expect(failing).toEqual([]);
    expect(process.exitCode).toBeUndefined();
    // With .mcp.json in place, it says what that launches.
    expect(report.project.checks.find((c) => c.name === "MCP server")?.detail).toContain("diffprism@latest serve");
  });

  it("finds a global skill an older version left behind", async () => {
    await doctor({ fix: true });
    fs.writeFileSync(path.join(home, ".claude", "skills", "review", "SKILL.md"), "an older skill");

    const report = await diagnose(repo);

    expect(states(report)["Global:/review skill"]).toBe("fixable");
    expect(report.global.checks[0].detail).toContain("out of date");
  });

  it("finds a pre-commit block that isn't this version's, and --fix replaces only that block", async () => {
    fs.mkdirSync(path.dirname(hookFile()), { recursive: true });
    fs.writeFileSync(
      hookFile(),
      "#!/bin/sh\nnpm run lint\n\n# >>> diffprism >>>\nnpx diffprism hook pre-commit\n# <<< diffprism <<<\n",
    );

    expect(states(await diagnose(repo))["Project:pre-commit hook"]).toBe("fixable");

    await doctor({ fix: true });

    expect(states(await diagnose(repo))["Project:pre-commit hook"]).toBe("ok");
    const hook = fs.readFileSync(hookFile(), "utf8");
    expect(hook).toContain("npm run lint");
    expect(hook).toContain("diffprism hook pre-commit || exit 1");
    expect(hook).not.toContain("npx diffprism hook pre-commit\n");
  });

  it("says which build the server is running", async () => {
    writeServerFile({ version: "1.10.2", devRoot: "/src/diffprism" });
    stubServer();

    const [check] = (await diagnose(repo)).server.checks;

    expect(check.state).toBe("ok");
    expect(check.detail).toContain(`PID ${process.pid}`);
    expect(check.detail).toContain("1.10.2 (dev build — /src/diffprism)");
  });

  it("--fix replaces an older server nobody is reviewing in", async () => {
    vi.mocked(builtAt).mockReturnValue(2000);
    writeServerFile({ builtAt: 1000 });
    stubServer();

    expect((await diagnose(repo)).server.checks[0].state).toBe("fixable");

    await doctor({ fix: true });
    expect(ensureServer).toHaveBeenCalled();
  });

  it("leaves an older server alone while a review is open in it", async () => {
    vi.mocked(builtAt).mockReturnValue(2000);
    writeServerFile({ builtAt: 1000 });
    stubServer([{ status: "in_review" }]);

    const [check] = (await diagnose(repo)).server.checks;
    expect(check.state).toBe("stale");
    expect(check.detail).toContain("1 open review");

    await doctor({ fix: true });
    expect(ensureServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("skips project checks outside a git repository", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-nogit-"));
    try {
      const report = await diagnose(elsewhere);
      expect(report.project.checks).toEqual([
        expect.objectContaining({ state: "info", detail: expect.stringContaining("not in a git repository") }),
      ]);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
