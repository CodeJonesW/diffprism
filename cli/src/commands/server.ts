import { startGlobalServer, readServerFile, isServerAlive } from "@diffprism/core";
import { setup, isGlobalSetupDone } from "./setup.js";

interface ServerFlags {
  port?: string;
  wsPort?: string;
  dev?: boolean;
}

export async function server(flags: ServerFlags): Promise<void> {
  // Check if a server is already running
  const existing = await isServerAlive();
  if (existing) {
    console.log(`DiffPrism server is already running on port ${existing.httpPort} (PID ${existing.pid})`);
    console.log(`Use 'diffprism server stop' to stop it first.`);
    process.exit(1);
    return;
  }

  // Auto-run global setup if needed
  if (!isGlobalSetupDone()) {
    console.log("Running global setup...\n");
    await setup({ global: true, quiet: false });
    console.log("");
  }

  const httpPort = flags.port ? parseInt(flags.port, 10) : undefined;
  const wsPort = flags.wsPort ? parseInt(flags.wsPort, 10) : undefined;

  try {
    const handle = await startGlobalServer({
      httpPort,
      wsPort,
      dev: flags.dev,
    });

    // Graceful shutdown on SIGINT/SIGTERM
    const shutdown = async () => {
      console.log("\nStopping server...");
      await handle.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep the process alive
    await new Promise(() => {
      // Never resolves — server runs until interrupted
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error starting server: ${message}`);
    process.exit(1);
  }
}

export async function serverStatus(): Promise<void> {
  const info = await isServerAlive();
  if (!info) {
    console.log("No DiffPrism server is running.");
    process.exit(1);
    return;
  }

  try {
    const response = await fetch(`http://localhost:${info.httpPort}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    const status = (await response.json()) as {
      running: boolean;
      pid: number;
      sessions: number;
      uptime: number;
    };

    console.log(`DiffPrism Server`);
    console.log(`  API:      http://localhost:${info.httpPort}`);
    console.log(`  WS:       ws://localhost:${info.wsPort}`);
    console.log(`  PID:      ${status.pid}`);
    console.log(`  Sessions: ${status.sessions}`);
    console.log(`  Uptime:   ${Math.floor(status.uptime)}s`);

    // List sessions if any
    if (status.sessions > 0) {
      const sessionsResponse = await fetch(
        `http://localhost:${info.httpPort}/api/reviews`,
        { signal: AbortSignal.timeout(2000) },
      );
      const { sessions } = (await sessionsResponse.json()) as {
        sessions: Array<{
          id: string;
          projectPath: string;
          branch?: string;
          title?: string;
          fileCount: number;
          additions: number;
          deletions: number;
          status: string;
        }>;
      };

      console.log(`\n  Active Sessions:`);
      for (const s of sessions) {
        const label = s.title ?? s.branch ?? s.projectPath;
        console.log(`    ${s.id} — ${label} (${s.status}, ${s.fileCount} files, +${s.additions}/-${s.deletions})`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error checking server status: ${message}`);
    process.exit(1);
  }
}

export async function serverStop(): Promise<void> {
  const info = readServerFile();
  if (!info) {
    console.log("No DiffPrism server is running.");
    return;
  }

  try {
    // Send kill signal to the server process
    process.kill(info.pid, "SIGTERM");
    console.log(`Sent stop signal to DiffPrism server (PID ${info.pid}).`);
  } catch {
    console.log(`Server process (PID ${info.pid}) is no longer running. Cleaning up.`);
  }
}
