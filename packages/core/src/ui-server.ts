import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Resolve the path to the pre-built UI dist directory.
 *
 * Two modes:
 * - Published: ui-dist/ is a sibling of dist/ in the package root
 * - Development: walk up to workspace root → packages/ui/dist/
 */
export function resolveUiDist(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  // Published mode: dist/ contains this file, ui-dist/ is a sibling
  const publishedUiDist = path.resolve(thisDir, "..", "ui-dist");
  if (fs.existsSync(path.join(publishedUiDist, "index.html"))) {
    return publishedUiDist;
  }

  // Development mode: thisDir is packages/core/src — go up 3 levels to workspace root
  const workspaceRoot = path.resolve(thisDir, "..", "..", "..");
  const devUiDist = path.join(workspaceRoot, "packages", "ui", "dist");
  if (fs.existsSync(path.join(devUiDist, "index.html"))) {
    return devUiDist;
  }

  throw new Error(
    "Could not find built UI. Run 'pnpm -F @diffprism/ui build' first.",
  );
}

/**
 * Resolve the path to the UI source directory (packages/ui).
 * Used in dev mode to run Vite's dev server with HMR.
 */
export function resolveUiRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  const workspaceRoot = path.resolve(thisDir, "..", "..", "..");
  const uiRoot = path.join(workspaceRoot, "packages", "ui");

  if (fs.existsSync(path.join(uiRoot, "index.html"))) {
    return uiRoot;
  }

  throw new Error(
    "Could not find UI source directory. Dev mode requires the diffprism workspace.",
  );
}

/**
 * Start a Vite dev server for the UI with HMR support.
 * Dynamically imports vite to avoid requiring it as a hard dependency.
 */
export async function startViteDevServer(
  uiRoot: string,
  port: number,
  silent: boolean,
): Promise<{ close: () => Promise<void> }> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: uiRoot,
    server: { port, strictPort: true, open: false },
    logLevel: silent ? "silent" : "warn",
  });
  await vite.listen();
  return vite;
}

/**
 * Create a static file server for the pre-built UI with SPA fallback.
 */
export function createStaticServer(
  distPath: string,
  port: number,
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] ?? "/";
    let filePath = path.join(distPath, urlPath === "/" ? "index.html" : urlPath);

    // If the file doesn't exist, serve index.html (SPA fallback)
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distPath, "index.html");
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}
