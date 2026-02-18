#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(__dirname, "..", "src", "index.ts");
const tsx = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");

try {
  execFileSync(tsx, [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch (e) {
  process.exit(e.status ?? 1);
}
