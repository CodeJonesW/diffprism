import open from "open";
import { buildFeedbackUrl, readLastError } from "@diffprism/core";

export interface FeedbackFlags {
  bug?: boolean;
  message?: string;
  print?: boolean;
}

/**
 * Open a prefilled GitHub issue for feedback or a bug report.
 *
 * Nothing is sent from here. The issue opens in the browser for the user to
 * read, edit and submit themselves — see buildFeedbackUrl.
 */
export async function feedback(flags: FeedbackFlags = {}): Promise<void> {
  const kind = flags.bug ? "bug" : "feedback";
  const error = flags.bug ? readLastError() : null;
  const url = buildFeedbackUrl({ kind, message: flags.message, error });

  if (flags.bug && error) {
    console.log(`Including the last error, from \`diffprism ${error.command}\` at ${error.at}.`);
  }
  console.log(
    flags.print
      ? url
      : `Opening a prefilled GitHub issue — review it, then submit if you're happy with it:\n${url}`,
  );

  if (!flags.print) {
    try {
      await open(url);
    } catch {
      // The URL is already printed above; if no browser can be launched here
      // (SSH, CI) the user can open it themselves.
    }
  }
}
