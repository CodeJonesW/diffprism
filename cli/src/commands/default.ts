import open from "open";
import { isServerAlive, ensureServer } from "@diffprism/core";

declare const DIFFPRISM_VERSION: string;

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

interface StatusResponse {
  running: boolean;
  pid: number;
  sessions: number;
  uptime: number;
  uiUrl: string | null;
}

async function fetchStatus(httpPort: number): Promise<StatusResponse> {
  const response = await fetch(`http://localhost:${httpPort}/api/status`, {
    signal: AbortSignal.timeout(2000),
  });
  return (await response.json()) as StatusResponse;
}

function printStatus(status: StatusResponse, httpPort: number): void {
  const version = typeof DIFFPRISM_VERSION !== "undefined" ? DIFFPRISM_VERSION : "0.0.0-dev";

  console.log(`\nDiffPrism v${version}\n`);
  console.log(`  Server:    running (PID ${status.pid}, uptime ${formatUptime(status.uptime)})`);
  if (status.uiUrl) {
    console.log(`  Dashboard: ${status.uiUrl.split("?")[0]}`);
  } else {
    console.log(`  API:       http://localhost:${httpPort}`);
  }
  console.log(`  Sessions:  ${status.sessions} active`);
  console.log();
  console.log(`  Quick start:`);
  console.log(`    diffprism review           Review local changes`);
  console.log(`    diffprism review --staged   Review staged changes`);
  console.log(`    diffprism setup            Set up Claude Code integration`);
  console.log(`    diffprism --help           Show all commands`);
  console.log();
}

export async function defaultAction(): Promise<void> {
  let info = await isServerAlive();

  if (!info) {
    console.log("Starting DiffPrism...");
    info = await ensureServer();
  }

  try {
    const status = await fetchStatus(info.httpPort);
    printStatus(status, info.httpPort);

    if (status.uiUrl) {
      await open(status.uiUrl);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error fetching server status: ${message}`);
    process.exit(1);
  }
}
