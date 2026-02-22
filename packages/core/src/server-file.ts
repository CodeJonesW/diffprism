import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GlobalServerInfo } from "./types.js";

function serverDir(): string {
  return path.join(os.homedir(), ".diffprism");
}

function serverFilePath(): string {
  return path.join(serverDir(), "server.json");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function writeServerFile(info: GlobalServerInfo): void {
  const dir = serverDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(serverFilePath(), JSON.stringify(info, null, 2) + "\n");
}

export function readServerFile(): GlobalServerInfo | null {
  const filePath = serverFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const info = JSON.parse(raw) as GlobalServerInfo;

    // Verify the process is still alive
    if (!isPidAlive(info.pid)) {
      // Clean up stale file
      fs.unlinkSync(filePath);
      return null;
    }

    return info;
  } catch {
    return null;
  }
}

export function removeServerFile(): void {
  try {
    const filePath = serverFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Check if a global server is running and reachable.
 * Reads the server file, verifies PID, then pings the HTTP API.
 */
export async function isServerAlive(): Promise<GlobalServerInfo | null> {
  const info = readServerFile();
  if (!info) {
    return null;
  }

  try {
    const response = await fetch(`http://localhost:${info.httpPort}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      return info;
    }
    return null;
  } catch {
    // Server file exists but server isn't responding — clean up
    removeServerFile();
    return null;
  }
}
