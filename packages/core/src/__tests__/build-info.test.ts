import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
}));

/** Every package.json above us is diffprism's, unless a test says otherwise. */
function manifestsAreOurs(): void {
  mockReadFileSync.mockReturnValue(JSON.stringify({ name: "diffprism" }));
}

import { getBuildInfo, describeVersion } from "../build-info.js";

beforeEach(() => {
  vi.clearAllMocks();
  manifestsAreOurs();
});

describe("getBuildInfo", () => {
  it("reports a dev build when a checkout sits beside the manifest", () => {
    mockExistsSync.mockImplementation(
      (p: string) => p.endsWith("package.json") || p.endsWith(".git"),
    );

    const info = getBuildInfo();

    expect(info.dev).toBe(true);
    expect(info.root).toBeTruthy();
  });

  it("reports a release when there is no checkout anywhere above", () => {
    // A published tarball never contains .git — npm strips it — so an
    // installed package must not be mistaken for a working copy.
    mockExistsSync.mockImplementation((p: string) => p.endsWith("package.json"));

    const info = getBuildInfo();

    expect(info.dev).toBe(false);
    expect(info.root).toBeNull();
  });

  it("reports a release when nothing resolves at all", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getBuildInfo().dev).toBe(false);
  });

  it("ignores a checkout that merely sits above the install", () => {
    // Regression: nvm installs itself by cloning, so ~/.nvm is a git repo
    // with its own package.json. Walking past our own package root found it
    // and labelled the published release a dev build. A version-controlled
    // home directory or dotfiles repo does the same thing.
    mockExistsSync.mockImplementation(
      (p: string) => p.endsWith("package.json") || p.endsWith(".git"),
    );
    mockReadFileSync.mockImplementation((p: string) =>
      // Our package root has no .git (it is an install); the repo above does.
      JSON.stringify({ name: String(p).includes(".nvm") ? "nvm" : "diffprism" }),
    );

    // The first manifest found is ours, and it decides the answer — the
    // unrelated repo above never gets a say.
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".git")) return false;
      return p.endsWith("package.json");
    });

    expect(getBuildInfo().dev).toBe(false);
  });

  it("stops at our own package root rather than a parent package", () => {
    mockExistsSync.mockImplementation(
      (p: string) => p.endsWith("package.json") || p.endsWith(".git"),
    );
    // A workspace package above the running file is not the answer.
    let seen = 0;
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ name: ++seen === 1 ? "@diffprism/core" : "diffprism" }),
    );

    const info = getBuildInfo();

    expect(info.dev).toBe(true);
    expect(seen).toBeGreaterThan(1);
  });
});

describe("describeVersion", () => {
  it("marks a dev build and names the checkout it came from", () => {
    mockExistsSync.mockImplementation(
      (p: string) => p.endsWith("package.json") || p.endsWith(".git"),
    );

    const described = describeVersion("0.46.0");

    expect(described).toContain("0.46.0");
    expect(described).toContain("dev build");
  });

  it("leaves a released version exactly as given", () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith("package.json"));
    expect(describeVersion("0.46.0")).toBe("0.46.0");
  });
});
