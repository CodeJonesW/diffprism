import os from "node:os";
import path from "node:path";
import {
  isServerAlive,
  decideOnRunningServer,
  ensureServer,
  builtAt,
  currentVersion,
  describeVersion,
  getBuildInfo,
} from "@diffprism/core";
import type { GlobalServerInfo } from "@diffprism/core";
import { setup, findGitRoot, readJsonFile } from "./setup.js";
import type { SetupArtifact, SetupStep } from "./setup.js";
import { hookStatus, refreshHook } from "./hook.js";

export interface DoctorFlags {
  fix?: boolean;
}

/**
 * One thing DiffPrism installed or runs, and whether it matches this build.
 * `ok` needs nothing; `fixable` is what `--fix` changes; `stale` is out of
 * date but can't be fixed from here yet; `info` is a fact, not a problem.
 */
export interface DoctorCheck {
  name: string;
  state: "ok" | "fixable" | "stale" | "info";
  detail: string;
}

export interface DoctorSection {
  title: string;
  checks: DoctorCheck[];
}

export interface DoctorReport {
  version: string;
  global: DoctorSection;
  project: DoctorSection;
  server: DoctorSection;
}

function sectionsOf(report: DoctorReport): DoctorSection[] {
  return [report.global, report.project, report.server];
}

const ARTIFACT_NAMES: Record<SetupArtifact, string> = {
  gitignore: ".gitignore",
  "mcp-json": ".mcp.json",
  permissions: "permissions",
  skill: "/review skill",
};

/**
 * What state this machine's DiffPrism install is in (#214). Read-only: it
 * asks the installers what they would change — setup's dry run, the hook's own
 * status, the server's replace decision — so there is no second definition of
 * "current" here to drift from theirs.
 */
export async function diagnose(cwd: string): Promise<DoctorReport> {
  const home = os.homedir();

  const globalPlan = await setup({ global: true, dryRun: true });
  const global: DoctorSection = {
    title: "Global (~/.claude)",
    checks: globalPlan.steps.map((step) => setupCheck(step, home)),
  };

  let project: DoctorSection;
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) {
    const projectPlan = await setup({ dryRun: true });
    const checks = projectPlan.steps.map((step) => setupCheck(step, gitRoot));
    const mcp = projectPlan.steps.find((s) => s.artifact === "mcp-json");
    if (mcp && mcp.action === "skipped") {
      checks.push(mcpLaunchCheck(mcp.filePath));
    }
    checks.push(hookCheck(cwd, gitRoot));
    project = { title: `Project (${gitRoot})`, checks };
  } else {
    project = {
      title: "Project",
      checks: [{ name: "project", state: "info", detail: "not in a git repository — project checks skipped" }],
    };
  }

  const server: DoctorSection = { title: "Server", checks: [await serverCheck()] };

  return { version: describeVersion(currentVersion()), global, project, server };
}

function setupCheck(step: SetupStep, baseDir: string): DoctorCheck {
  const where = path.relative(baseDir, step.filePath) || step.filePath;
  const name = ARTIFACT_NAMES[step.artifact];
  switch (step.action) {
    case "skipped":
      return { name, state: "ok", detail: where };
    case "created":
      return { name, state: "fixable", detail: `${where} — missing` };
    case "updated":
      return { name, state: "fixable", detail: `${where} — out of date for this version` };
  }
}

/** What Claude Code launches for DiffPrism's MCP tools in this project. */
function mcpLaunchCheck(filePath: string): DoctorCheck {
  const servers = (readJsonFile(filePath).mcpServers ?? {}) as Record<string, { command?: string; args?: string[] }>;
  const entry = servers.diffprism;
  const launches = [entry?.command, ...(entry?.args ?? [])].filter(Boolean).join(" ");
  // A dev build's own setup still registers the npm release (#200).
  const detail = getBuildInfo().dev && /\bdiffprism@/.test(launches)
    ? `launches \`${launches}\` — the npm release, not this dev build (#200)`
    : `launches \`${launches}\``;
  return { name: "MCP server", state: "info", detail };
}

const HOOK = "pre-commit hook";

function hookCheck(cwd: string, gitRoot: string): DoctorCheck {
  const { hookPath, state } = hookStatus(cwd);
  const where = path.relative(gitRoot, hookPath) || hookPath;
  switch (state) {
    case "not-installed":
      return { name: HOOK, state: "info", detail: "not installed (`diffprism hook install` gates commits on a review)" };
    case "current":
      return { name: HOOK, state: "ok", detail: where };
    case "stale":
      return { name: HOOK, state: "fixable", detail: `${where} — the diffprism block is not this version's` };
  }
}

async function serverCheck(): Promise<DoctorCheck> {
  const server = await isServerAlive();
  if (!server) {
    return { name: "server", state: "info", detail: "not running — the next review starts it" };
  }

  const running = describeServer(server);
  const decision = await decideOnRunningServer(server, builtAt());
  switch (decision.action) {
    case "replace":
      return { name: "server", state: "fixable", detail: `${running} — an older build than this one` };
    case "keep-busy":
      return {
        name: "server",
        state: "stale",
        detail: `${running} — an older build, kept up by ${decision.openReviews} open review${decision.openReviews === 1 ? "" : "s"}. Finish ${decision.openReviews === 1 ? "it" : "them"}, or \`diffprism server stop\` (#199)`,
      };
    case "keep":
      return { name: "server", state: "ok", detail: running };
  }
}

function describeServer(server: GlobalServerInfo): string {
  const build = server.version
    ? server.devRoot
      ? `${server.version} (dev build — ${server.devRoot})`
      : server.version
    : "an unrecorded version (started before doctor existed)";
  return `port ${server.httpPort}, PID ${server.pid}, up ${formatUptime(Date.now() - server.startedAt)}, running ${build}`;
}

function formatUptime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const MARKS: Record<DoctorCheck["state"], string> = { ok: "✓", fixable: "✗", stale: "!", info: "·" };

export function formatReport(report: DoctorReport): string {
  const lines = [`DiffPrism ${report.version}`];
  for (const section of sectionsOf(report)) {
    lines.push("", section.title);
    for (const check of section.checks) {
      lines.push(`  ${MARKS[check.state]} ${check.name.padEnd(16)} ${check.detail}`);
    }
  }
  return lines.join("\n");
}

function needing(report: DoctorReport, state: DoctorCheck["state"]): string[] {
  return sectionsOf(report).flatMap((s) => s.checks.filter((c) => c.state === state).map((c) => `${s.title}: ${c.name}`));
}

/** `diffprism doctor` — report the install; with `--fix`, apply what setup would. */
export async function doctor(flags: DoctorFlags = {}): Promise<void> {
  const cwd = process.cwd();
  let report = await diagnose(cwd);

  if (flags.fix && needing(report, "fixable").length > 0) {
    await fix(report, cwd);
    report = await diagnose(cwd);
  }

  console.log(formatReport(report));

  const fixable = needing(report, "fixable");
  const stale = needing(report, "stale");
  console.log("");
  if (fixable.length > 0) {
    console.log(`${fixable.length} out of date. Run \`diffprism doctor --fix\` to update ${fixable.length === 1 ? "it" : "them"}.`);
  } else if (stale.length === 0) {
    console.log("Everything matches this version.");
  }
  if (fixable.length > 0 || stale.length > 0) {
    process.exitCode = 1;
  }
}

async function fix(report: DoctorReport, cwd: string): Promise<void> {
  const hasFixable = (section: DoctorSection, names?: string[]) =>
    section.checks.some((c) => c.state === "fixable" && (!names || names.includes(c.name)));

  if (hasFixable(report.global)) {
    await setup({ global: true, quiet: true });
  }
  if (hasFixable(report.project, Object.values(ARTIFACT_NAMES))) {
    await setup({ quiet: true });
  }
  if (hasFixable(report.project, [HOOK])) {
    refreshHook(cwd);
  }
  if (hasFixable(report.server)) {
    // The same replacement any command makes when it finds an older, idle server.
    await ensureServer();
  }
}
