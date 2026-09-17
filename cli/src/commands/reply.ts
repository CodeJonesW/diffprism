import { isServerAlive, recordError, REPORT_HINT } from "@diffprism/core";

export interface ReplyFlags {
  session: string;
  agent?: string;
}

/**
 * The command that answers a thread, as printed wherever a wait ends on a
 * question. The instructions and the command live together so they can't
 * drift: whoever ran `git commit` or `diffprism review` has a shell, and
 * nothing else — an MCP server may not be connected at all.
 */
export function replyCommandFor(sessionId: string, annotationId: string): string {
  return `diffprism reply --session ${sessionId} ${annotationId} "<your answer>"`;
}

/** Post an agent's reply to a thread on an open review. */
export async function reply(annotationId: string, words: string[], flags: ReplyFlags): Promise<void> {
  const body = words.join(" ").trim();
  if (!body) {
    fail("Nothing to say: pass the reply after the annotation id.");
    return;
  }

  const serverInfo = await isServerAlive();
  if (!serverInfo) {
    fail("No DiffPrism server is running, so there is no open review to reply on.");
    return;
  }

  let response: Response;
  try {
    response = await fetch(
      `http://localhost:${serverInfo.httpPort}/api/reviews/${flags.session}/annotations/${annotationId}/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "agent", agent: flags.agent ?? "agent", body }),
      },
    );
  } catch (err) {
    recordError("reply", err);
    fail(`Could not reach the DiffPrism server: ${err instanceof Error ? err.message : String(err)}\n${REPORT_HINT}`);
    return;
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    annotation?: { file: string; line: number };
  };
  if (!response.ok) {
    fail(`Reply not posted: ${data.error ?? `server returned ${response.status}`}`);
    return;
  }

  const where = data.annotation ? ` on ${data.annotation.file}:${data.annotation.line}` : "";
  console.log(`Replied${where}. It shows in the review now.`);
  // Said here, at the moment of acting, and not only where the question was
  // printed: an agent that has just answered tends to stop and report back in
  // the terminal, while the reviewer is still in the dashboard — and whatever
  // they ask next reaches no one until something waits again.
  console.log(
    "The review is still open. Go back to waiting for the decision now: run the same command that opened it again (`git commit` or `diffprism review`). It returns the decision, or the reviewer's next question. Don't ask them in the terminal.",
  );
}

function fail(message: string): void {
  console.error(message);
  process.exit(1);
}
