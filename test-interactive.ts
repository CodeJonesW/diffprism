import { getDiff } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";
import { createWsBridge } from "@diffprism/core/src/ws-bridge.js";
import { createServer } from "vite";
import getPort from "get-port";
import open from "open";

const { diffSet, rawDiff } = getDiff("staged", { cwd: "/Users/willjones/dev/diffprism" });

if (diffSet.files.length === 0) {
  console.log("No staged changes to review.");
  process.exit(0);
}

const briefing = analyze(diffSet);

const wsPort = await getPort();
const vitePort = await getPort();

const bridge = createWsBridge(wsPort);

const vite = await createServer({
  root: "/Users/willjones/dev/diffprism/packages/ui",
  server: { port: vitePort, strictPort: true, open: false },
  logLevel: "warn",
});
await vite.listen();

const url = `http://localhost:${vitePort}?wsPort=${wsPort}&reviewId=test-1`;
console.log(`\nDiffPrism Review: ${briefing.summary}`);
console.log(`URL: ${url}`);
console.log("Waiting for your review...\n");

bridge.sendInit({
  reviewId: "test-1",
  diffSet,
  rawDiff,
  briefing,
  metadata: { title: process.argv[2] || "Code Review" },
});

await open(url);

try {
  const result = await bridge.waitForResult();
  console.log("\nReview result:");
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("\n" + (e instanceof Error ? e.message : e));
} finally {
  bridge.close();
  await vite.close();
  process.exit(0);
}
