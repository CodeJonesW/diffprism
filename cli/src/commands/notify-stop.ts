import { readWatchFile } from "@diffprism/core";

export async function notifyStop(): Promise<void> {
  try {
    const watchInfo = readWatchFile();
    if (!watchInfo) {
      // No watch running — silently exit
      process.exit(0);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      await fetch(`http://localhost:${watchInfo.wsPort}/api/refresh`, {
        method: "POST",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Silently exit on any error — must never block Claude Code
  }

  process.exit(0);
}
