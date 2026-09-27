import { describe, it, expect } from "vitest";
import { diffNewSide } from "../diff-scope.js";

describe("diffNewSide (#238)", () => {
  it("is the index for the commit gate's staged diff, not HEAD or the files on disk", () => {
    expect(diffNewSide("staged")).toEqual({ kind: "index" });
  });

  it("is the right end of a range, HEAD when that end is left out", () => {
    expect(diffNewSide("main..feature")).toEqual({ kind: "commit", ref: "feature" });
    expect(diffNewSide("main...feature")).toEqual({ kind: "commit", ref: "feature" });
    expect(diffNewSide("HEAD~3..")).toEqual({ kind: "commit", ref: "HEAD" });
  });

  it("is the working tree for uncommitted changes, and for a single ref git diffs against it", () => {
    expect(diffNewSide("working-copy")).toEqual({ kind: "working-tree" });
    expect(diffNewSide("unstaged")).toEqual({ kind: "working-tree" });
    expect(diffNewSide("main")).toEqual({ kind: "working-tree" });
  });
});
