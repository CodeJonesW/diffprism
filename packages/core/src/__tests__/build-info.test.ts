import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExistsSync = vi.fn();
vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
}));

import { getBuildInfo, describeVersion } from "../build-info.js";

beforeEach(() => {
  vi.clearAllMocks();
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
