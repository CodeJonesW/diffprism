/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { OpenProjectForm } from "../components/Dashboard/Dashboard";

function stubServer(defaultDiffRef: string | undefined) {
  let releaseStatus!: () => void;
  const statusReady = new Promise<void>((resolve) => (releaseStatus = resolve));

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/status")) {
        await statusReady;
        return { ok: true, json: async () => ({ cwd: "/work", defaultDiffRef }) };
      }
      if (url.includes("/api/fs/list")) {
        return { ok: true, json: async () => ({ path: "/work", parentPath: "/", isGitRepo: true, dirs: [] }) };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
  return releaseStatus;
}

beforeEach(() => {
  window.history.pushState({}, "", "/?httpPort=24680");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OpenProjectForm diff scope (#164)", () => {
  it("waits for the server's default rather than assuming one", async () => {
    stubServer("working-copy"); // never released
    render(<OpenProjectForm />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it("uses whatever default the server reports", async () => {
    // "staged" is deliberately not the real default: if the form had its own
    // copy of the default, this would still show the working copy.
    const release = stubServer("staged");
    render(<OpenProjectForm />);
    release();

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.disabled).toBe(false);
      expect(select.value).toBe("staged");
    });
  });
});
