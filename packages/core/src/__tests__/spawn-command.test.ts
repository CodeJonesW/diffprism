import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
}));

import { buildDefaultSpawnCommand } from "../server-client.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildDefaultSpawnCommand", () => {
  it("uses the workspace bin when running from source", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith("cli/bin/diffprism.mjs"),
    );

    const args = buildDefaultSpawnCommand({});

    expect(args[0]).toBe(process.execPath);
    expect(args[1]).toMatch(/cli\/bin\/diffprism\.mjs$/);
    expect(args).toContain("--_daemon");
  });

  it("executes the node_modules shim directly, never through node", () => {
    // Regression: npm writes .bin entries as shell scripts. Handing one to
    // node makes node parse shell as JavaScript and die on
    // `basedir=$(dirname ...)` with "missing ) after argument list".
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith("node_modules/.bin/diffprism"),
    );

    const args = buildDefaultSpawnCommand({});

    expect(args[0]).toMatch(/node_modules\/\.bin\/diffprism$/);
    expect(args).not.toContain(process.execPath);
    expect(args.slice(1)).toEqual(["server", "--_daemon"]);
  });

  it("reads the package's own bin for a global install, which has no .bin shim", () => {
    // A global install links the executable from the npm prefix, which is
    // nowhere above this file — so the only way to find it is the manifest.
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith("node_modules/.bin/diffprism")) return false;
      if (p.endsWith("cli/bin/diffprism.mjs")) return false;
      return p.endsWith("package.json") || p.endsWith("dist/bin.js");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ name: "diffprism", bin: { diffprism: "dist/bin.js" } }),
    );

    const args = buildDefaultSpawnCommand({});

    expect(args[0]).toBe(process.execPath);
    expect(args[1]).toMatch(/dist\/bin\.js$/);
  });

  it("never passes a bare name as an argument to node", () => {
    // Regression: the old fallback produced [node, "diffprism", ...], and node
    // resolves a bare specifier against the CURRENT WORKING DIRECTORY — so the
    // daemon died with "Cannot find module '<cwd>/diffprism'" and every review
    // failed to start on a global install.
    mockExistsSync.mockReturnValue(false);

    const args = buildDefaultSpawnCommand({});

    expect(args[0]).toBe("diffprism");
    expect(args).not.toContain(process.execPath);
    expect(args.slice(1)).toEqual(["server", "--_daemon"]);
  });

  it("tolerates an unreadable package.json above it", () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith("package.json"));
    mockReadFileSync.mockReturnValue("{ not json");

    const args = buildDefaultSpawnCommand({});

    expect(args[0]).toBe("diffprism");
  });

  it("passes --dev through on every resolution path", () => {
    mockExistsSync.mockReturnValue(false);
    expect(buildDefaultSpawnCommand({ dev: true })).toContain("--dev");

    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith("cli/bin/diffprism.mjs"),
    );
    expect(buildDefaultSpawnCommand({ dev: true })).toContain("--dev");
  });
});
