import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBuildInfo } from "./build-info.js";

declare const DIFFPRISM_VERSION: string;

/**
 * Feedback and bug reports go to GitHub as a prefilled issue.
 *
 * There is no DiffPrism backend to send telemetry to, and quietly collecting
 * data from someone's machine is not a decision to make on their behalf. So
 * nothing is sent automatically: the tool builds an issue — version, platform,
 * the error they hit — and opens it in their browser, where they can read and
 * edit every word before choosing to submit.
 *
 * A test asserts this matches `repository.url` in the root package.json.
 */
export const ISSUES_NEW_URL = "https://github.com/CodeJonesW/diffprism/issues/new";

/** GitHub rejects very long new-issue URLs; keep the error well inside that. */
const MAX_ERROR_CHARS = 1500;

export function currentVersion(): string {
  return typeof DIFFPRISM_VERSION !== "undefined" ? DIFFPRISM_VERSION : "0.0.0-dev";
}

export interface Environment {
  version: string;
  build: "release" | "dev build";
  os: string;
  node: string;
}

export function describeEnvironment(): Environment {
  return {
    version: currentVersion(),
    // Whether it is a dev build, but not where: the checkout path is private.
    build: getBuildInfo().dev ? "dev build" : "release",
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    node: process.version,
  };
}

// ─── The last error, kept for a bug report ───

export interface ErrorReport {
  /** Which command or tool failed, e.g. "review" or "hook pre-commit". */
  command: string;
  message: string;
  at: string;
}

function lastErrorFile(): string {
  return path.join(os.homedir(), ".diffprism", "last-error.json");
}

/**
 * Remember an error so `diffprism feedback --bug` can include it. It stays on
 * this machine unless the user chooses to report it.
 */
export function recordError(command: string, err: unknown): void {
  const report: ErrorReport = {
    command,
    message: err instanceof Error ? err.message : String(err),
    at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(lastErrorFile()), { recursive: true });
    fs.writeFileSync(lastErrorFile(), JSON.stringify(report, null, 2));
  } catch {
    // Deliberately swallowed. This runs while reporting some other failure;
    // being unable to save a copy for a bug report must not replace the error
    // the user actually needs to see.
  }
}

export function readLastError(): ErrorReport | null {
  try {
    return JSON.parse(fs.readFileSync(lastErrorFile(), "utf8")) as ErrorReport;
  } catch {
    return null;
  }
}

/** One line for the end of an error: how to report it if it is a bug. */
export const REPORT_HINT = "Think this is a DiffPrism bug? Report it: diffprism feedback --bug";

/** Replace the home directory with ~ so a report doesn't carry a username. */
export function redactHome(text: string): string {
  const home = os.homedir();
  return home ? text.split(home).join("~") : text;
}

// ─── The issue ───

export interface FeedbackOptions {
  kind: "bug" | "feedback";
  message?: string;
  error?: ErrorReport | null;
  environment?: Environment;
}

export function buildFeedbackUrl(options: FeedbackOptions): string {
  const env = options.environment ?? describeEnvironment();
  const message = options.message?.trim();
  const error = options.kind === "bug" ? options.error : null;

  const firstLine = (text: string) => text.split("\n")[0].slice(0, 80);
  const title =
    options.kind === "bug"
      ? `Bug: ${firstLine(message || (error ? redactHome(error.message) : "")) || "describe the problem"}`
      : `Feedback: ${message ? firstLine(message) : "your idea or experience"}`;

  const sections: string[] = [];

  if (options.kind === "bug") {
    sections.push(`### What happened\n\n${message || "<!-- What were you doing, and what went wrong? -->"}`);
    sections.push("### What you expected\n\n<!-- What should have happened instead? -->");
  } else {
    sections.push(`### Feedback\n\n${message || "<!-- What's working, what isn't, what you wish it did. -->"}`);
  }

  if (error) {
    let errorText = redactHome(error.message);
    if (errorText.length > MAX_ERROR_CHARS) {
      errorText = `${errorText.slice(0, MAX_ERROR_CHARS)}\n… (truncated)`;
    }
    sections.push(`### Last error\n\n\`diffprism ${error.command}\` at ${error.at}\n\n\`\`\`\n${errorText}\n\`\`\``);
  }

  sections.push(
    [
      "### Environment",
      "",
      "| | |",
      "|---|---|",
      `| DiffPrism | ${env.version} (${env.build}) |`,
      `| OS | ${env.os} |`,
      `| Node | ${env.node} |`,
    ].join("\n"),
  );

  sections.push("<!-- Everything above is visible before you submit. Remove anything you don't want to share publicly. -->");

  const params = new URLSearchParams({
    title,
    body: sections.join("\n\n"),
    labels: options.kind === "bug" ? "bug" : "feedback",
  });
  return `${ISSUES_NEW_URL}?${params.toString()}`;
}
