import { describe, it, expect } from "vitest";
import { normalizePr } from "../normalize.js";
import type { PrMetadata } from "../client.js";

const FIXTURE_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,6 @@
 import { foo } from "./foo";

-export function main() {
+export function main(): void {
   foo();
+  console.log("hello");
 }
`;

const FIXTURE_PR: PrMetadata = {
  owner: "anthropics",
  repo: "diffprism",
  number: 42,
  title: "Add type annotation and logging",
  author: "octocat",
  url: "https://github.com/anthropics/diffprism/pull/42",
  baseBranch: "main",
  headBranch: "feature/type-annotation",
  body: "This PR adds type annotations and logging.",
};

describe("normalizePr", () => {
  it("parses the diff into a DiffSet", () => {
    const { diffSet } = normalizePr(FIXTURE_DIFF, FIXTURE_PR);

    expect(diffSet.files).toHaveLength(1);
    expect(diffSet.files[0].path).toBe("src/index.ts");
    expect(diffSet.files[0].additions).toBe(2);
    expect(diffSet.files[0].deletions).toBe(1);
    expect(diffSet.baseRef).toBe("main");
    expect(diffSet.headRef).toBe("feature/type-annotation");
  });

  it("produces a ReviewBriefing", () => {
    const { briefing } = normalizePr(FIXTURE_DIFF, FIXTURE_PR);

    expect(briefing.summary).toContain("1 files changed");
    expect(briefing.fileStats).toHaveLength(1);
    expect(briefing.fileStats[0].path).toBe("src/index.ts");
  });

  it("includes GitHub PR metadata in ReviewMetadata", () => {
    const { metadata } = normalizePr(FIXTURE_DIFF, FIXTURE_PR);

    expect(metadata.githubPr).toEqual({
      owner: "anthropics",
      repo: "diffprism",
      number: 42,
      title: "Add type annotation and logging",
      author: "octocat",
      url: "https://github.com/anthropics/diffprism/pull/42",
      baseBranch: "main",
      headBranch: "feature/type-annotation",
    });
  });

  it("generates a default title from PR metadata", () => {
    const { metadata } = normalizePr(FIXTURE_DIFF, FIXTURE_PR);
    expect(metadata.title).toBe("PR #42: Add type annotation and logging");
  });

  it("allows overriding the title", () => {
    const { metadata } = normalizePr(FIXTURE_DIFF, FIXTURE_PR, {
      title: "Custom title",
    });
    expect(metadata.title).toBe("Custom title");
  });

  it("includes PR body as description", () => {
    const { metadata } = normalizePr(FIXTURE_DIFF, FIXTURE_PR);
    expect(metadata.description).toBe("This PR adds type annotations and logging.");
  });

  it("includes reasoning when provided", () => {
    const { metadata } = normalizePr(FIXTURE_DIFF, FIXTURE_PR, {
      reasoning: "Reviewing for code quality",
    });
    expect(metadata.reasoning).toBe("Reviewing for code quality");
  });

  it("builds a complete ReviewInitPayload", () => {
    const { payload } = normalizePr(FIXTURE_DIFF, FIXTURE_PR);

    expect(payload.reviewId).toBe("");
    expect(payload.diffSet.files).toHaveLength(1);
    expect(payload.rawDiff).toBe(FIXTURE_DIFF);
    expect(payload.briefing.summary).toBeTruthy();
    expect(payload.metadata.githubPr?.number).toBe(42);
  });

  it("handles empty diff", () => {
    const { diffSet, briefing } = normalizePr("", FIXTURE_PR);
    expect(diffSet.files).toHaveLength(0);
    expect(briefing.summary).toContain("0 files changed");
  });
});
