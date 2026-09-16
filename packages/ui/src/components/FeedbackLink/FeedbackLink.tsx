import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";

/**
 * A link to share feedback as a prefilled GitHub issue.
 *
 * The URL is fetched up front and rendered as a plain link rather than opened
 * from a click handler: opening a window after an `await` isn't treated as a
 * user gesture, and browsers block it as a popup.
 */
export function FeedbackLink() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const httpPort = new URLSearchParams(window.location.search).get("httpPort");
    if (!httpPort) return;

    fetch(`http://localhost:${httpPort}/api/feedback?kind=feedback`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { url?: string } | null) => {
        if (data?.url) setUrl(data.url);
      })
      .catch(() => {
        // No server, no link — the CLI's `diffprism feedback` still works.
      });
  }, []);

  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors"
      title="Opens a prefilled GitHub issue. Nothing is sent until you submit it."
    >
      <MessageSquare className="w-3 h-3" />
      Send feedback
    </a>
  );
}
