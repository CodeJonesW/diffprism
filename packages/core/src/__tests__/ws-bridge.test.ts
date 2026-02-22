import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createWsBridge } from "../ws-bridge.js";
import type { WsBridge } from "../ws-bridge.js";
import type {
  ReviewInitPayload,
  ServerMessage,
  ClientMessage,
} from "../types.js";

const TEST_PORT = 9871;

function makeInitPayload(): ReviewInitPayload {
  return {
    reviewId: "test-review-1",
    diffSet: { baseRef: "HEAD", headRef: "staged", files: [] },
    rawDiff: "",
    briefing: {
      summary: "Test",
      triage: { critical: [], notable: [], mechanical: [] },
      impact: {
        affectedModules: [],
        affectedTests: [],
        publicApiChanges: false,
        breakingChanges: [],
        newDependencies: [],
      },
      verification: { testsPass: null, typeCheck: null, lintClean: null },
      fileStats: [],
    },
    metadata: {},
  };
}

/**
 * Connect a WS client and capture the first message (if any) that arrives
 * during or immediately after the handshake.
 */
function connectClient(port: number): {
  ws: Promise<WebSocket>;
  firstMessage: Promise<ServerMessage>;
} {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const firstMessage = new Promise<ServerMessage>((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
  const ready = new Promise<WebSocket>((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
  return { ws: ready, firstMessage };
}

describe("ws-bridge", () => {
  let bridge: WsBridge;

  afterEach(() => {
    bridge?.close();
  });

  it("sends pending init payload when client connects after sendInit", async () => {
    bridge = createWsBridge(TEST_PORT);
    const payload = makeInitPayload();

    // Send init before any client is connected — stored as pending
    bridge.sendInit(payload);

    // Connect — message listener is registered before open, so we catch it
    const { ws, firstMessage } = connectClient(TEST_PORT);
    const client = await ws;
    const msg = await firstMessage;

    expect(msg.type).toBe("review:init");
    if (msg.type === "review:init") {
      expect(msg.payload.reviewId).toBe("test-review-1");
    }

    client.close();
  });

  it("sends init payload immediately if client is already connected", async () => {
    bridge = createWsBridge(TEST_PORT);
    const payload = makeInitPayload();

    const { ws } = connectClient(TEST_PORT);
    const client = await ws;

    // Small delay to ensure connection is registered on bridge side
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = new Promise<ServerMessage>((resolve) => {
      client.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
    bridge.sendInit(payload);
    const msg = await msgPromise;

    expect(msg.type).toBe("review:init");
    if (msg.type === "review:init") {
      expect(msg.payload.reviewId).toBe("test-review-1");
    }

    client.close();
  });

  it("resolves waitForResult when client sends review:submit", async () => {
    bridge = createWsBridge(TEST_PORT);

    const resultPromise = bridge.waitForResult();

    const { ws } = connectClient(TEST_PORT);
    const client = await ws;

    const submitMsg: ClientMessage = {
      type: "review:submit",
      payload: {
        decision: "approved",
        comments: [],
        summary: "LGTM",
      },
    };
    client.send(JSON.stringify(submitMsg));

    const result = await resultPromise;
    expect(result.decision).toBe("approved");
    expect(result.summary).toBe("LGTM");

    client.close();
  });

  it("ignores malformed messages without crashing", async () => {
    bridge = createWsBridge(TEST_PORT);

    const { ws } = connectClient(TEST_PORT);
    const client = await ws;

    // Send garbage — should not throw or crash the bridge
    client.send("not-json");
    client.send(JSON.stringify({ type: "unknown" }));

    // Bridge should still be functional — send a valid submit
    const resultPromise = bridge.waitForResult();
    const submitMsg: ClientMessage = {
      type: "review:submit",
      payload: {
        decision: "changes_requested",
        comments: [],
      },
    };
    client.send(JSON.stringify(submitMsg));

    const result = await resultPromise;
    expect(result.decision).toBe("changes_requested");

    client.close();
  });

  it("replays init payload on reconnect", async () => {
    bridge = createWsBridge(TEST_PORT);
    const payload = makeInitPayload();

    bridge.sendInit(payload);

    // First client connects, receives init
    const conn1 = connectClient(TEST_PORT);
    const client1 = await conn1.ws;
    const msg1 = await conn1.firstMessage;
    expect(msg1.type).toBe("review:init");

    // First client disconnects
    client1.close();
    await new Promise((r) => setTimeout(r, 100));

    // Second client connects — should get init replayed
    const conn2 = connectClient(TEST_PORT);
    const client2 = await conn2.ws;
    const msg2 = await conn2.firstMessage;
    expect(msg2.type).toBe("review:init");
    if (msg2.type === "review:init") {
      expect(msg2.payload.reviewId).toBe("test-review-1");
    }

    client2.close();
  });

  it("rejects waitForResult if client disconnects and no reconnect within grace period", async () => {
    bridge = createWsBridge(TEST_PORT);

    const resultPromise = bridge.waitForResult();

    const { ws } = connectClient(TEST_PORT);
    const client = await ws;
    // Close immediately without submitting
    client.close();

    // Wait longer than the 2s grace period
    await expect(resultPromise).rejects.toThrow(
      "Browser closed before review was submitted",
    );
  }, 10000);

  it("does not reject if a new client reconnects within the grace period", async () => {
    bridge = createWsBridge(TEST_PORT);
    const payload = makeInitPayload();
    bridge.sendInit(payload);

    const resultPromise = bridge.waitForResult();

    // First client connects then disconnects
    const conn1 = connectClient(TEST_PORT);
    const client1 = await conn1.ws;
    await conn1.firstMessage; // consume init
    client1.close();

    // Reconnect within the 2s grace period
    await new Promise((r) => setTimeout(r, 500));
    const conn2 = connectClient(TEST_PORT);
    const client2 = await conn2.ws;
    await conn2.firstMessage; // consume replayed init

    // Submit from second client
    const submitMsg: ClientMessage = {
      type: "review:submit",
      payload: {
        decision: "approved_with_comments",
        comments: [],
        summary: "Reconnected and approved",
      },
    };
    client2.send(JSON.stringify(submitMsg));

    const result = await resultPromise;
    expect(result.decision).toBe("approved_with_comments");

    client2.close();
  });
});
