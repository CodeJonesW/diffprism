import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    bin: "cli/src/index.ts",
    "mcp-server": "packages/mcp-server/src/index.ts",
  },
  format: "esm",
  target: "node20",
  platform: "node",
  outDir: "dist",
  splitting: true,
  clean: true,
  // Inline all @diffprism/* workspace packages
  noExternal: [/@diffprism\/.*/],
  // Keep third-party deps external (installed from npm)
  external: [
    "ws",
    "open",
    "get-port",
    "commander",
    "@modelcontextprotocol/sdk",
    "zod",
  ],
});
