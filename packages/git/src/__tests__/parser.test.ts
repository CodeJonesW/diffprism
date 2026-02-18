import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDiff } from "../parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", name), "utf-8");

describe("parseDiff", () => {
  it("returns empty files array for empty input", () => {
    const result = parseDiff("", "HEAD", "staged");
    expect(result.files).toEqual([]);
    expect(result.baseRef).toBe("HEAD");
    expect(result.headRef).toBe("staged");
  });

  it("parses a simple modification", () => {
    const result = parseDiff(fixture("simple-modify.diff"), "HEAD", "staged");

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.path).toBe("src/index.ts");
    expect(file.status).toBe("modified");
    expect(file.language).toBe("typescript");
    expect(file.binary).toBe(false);
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(5);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(6);

    const adds = hunk.changes.filter((c) => c.type === "add");
    const deletes = hunk.changes.filter((c) => c.type === "delete");
    expect(adds).toHaveLength(2);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].content).toBe("export function main() {");
    expect(adds[0].content).toBe("export function main(): void {");
  });

  it("parses added, deleted, and renamed files", () => {
    const result = parseDiff(
      fixture("add-delete-rename.diff"),
      "main",
      "feature",
    );

    expect(result.files).toHaveLength(3);

    const added = result.files.find((f) => f.status === "added")!;
    expect(added.path).toBe("src/new-file.py");
    expect(added.language).toBe("python");
    expect(added.additions).toBe(3);
    expect(added.deletions).toBe(0);

    const deleted = result.files.find((f) => f.status === "deleted")!;
    expect(deleted.path).toBe("src/old-file.ts");
    expect(deleted.language).toBe("typescript");
    expect(deleted.additions).toBe(0);
    expect(deleted.deletions).toBe(2);

    const renamed = result.files.find((f) => f.status === "renamed")!;
    expect(renamed.path).toBe("src/after.ts");
    expect(renamed.oldPath).toBe("src/before.ts");
    expect(renamed.additions).toBe(1);
    expect(renamed.deletions).toBe(1);
  });

  it("detects binary files", () => {
    const result = parseDiff(fixture("binary.diff"), "HEAD", "staged");

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.path).toBe("assets/logo.png");
    expect(file.binary).toBe(true);
    expect(file.status).toBe("added");
    expect(file.hunks).toHaveLength(0);
  });

  it("handles multiple hunks in one file", () => {
    const result = parseDiff(fixture("multi-hunk.diff"), "HEAD~1", "HEAD");

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.hunks).toHaveLength(2);
    expect(file.hunks[0].oldStart).toBe(1);
    expect(file.hunks[1].oldStart).toBe(20);
  });

  it("handles 'no newline at end of file' marker", () => {
    const result = parseDiff(fixture("no-newline.diff"), "HEAD", "staged");

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.language).toBe("json");
    // The marker should be skipped, not included as a change
    const changes = file.hunks[0].changes;
    const noNewline = changes.find((c) =>
      c.content.includes("No newline at end of file"),
    );
    expect(noNewline).toBeUndefined();
  });

  it("detects languages by extension", () => {
    const diff = `diff --git a/app.jsx b/app.jsx
index abc..def 100644
--- a/app.jsx
+++ b/app.jsx
@@ -1 +1 @@
-old
+new
diff --git a/Dockerfile b/Dockerfile
index abc..def 100644
--- a/Dockerfile
+++ b/Dockerfile
@@ -1 +1 @@
-FROM old
+FROM new
diff --git a/unknown.xyz b/unknown.xyz
index abc..def 100644
--- a/unknown.xyz
+++ b/unknown.xyz
@@ -1 +1 @@
-old
+new
`;
    const result = parseDiff(diff, "a", "b");
    expect(result.files[0].language).toBe("javascript");
    expect(result.files[1].language).toBe("dockerfile");
    expect(result.files[2].language).toBe("text");
  });
});
