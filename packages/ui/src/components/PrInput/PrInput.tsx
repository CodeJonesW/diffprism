import { useState, useCallback } from "react";
import { GitPullRequest, Loader2, ExternalLink } from "lucide-react";

interface PrInputProps {
  onSuccess?: () => void;
}

function getHttpPort(): string | null {
  return new URLSearchParams(window.location.search).get("httpPort");
}

interface PrOpenResult {
  sessionId: string;
  fileCount: number;
  localRepoPath: string | null;
  pr: {
    title: string;
    author: string;
    url: string;
    baseBranch: string;
    headBranch: string;
  };
}

export function PrInput({ onSuccess }: PrInputProps) {
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const httpPort = getHttpPort();
    if (!httpPort || !prUrl.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`http://localhost:${httpPort}/api/pr/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl: prUrl.trim() }),
      });
      const data = await res.json() as PrOpenResult & { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to open PR");
      } else {
        setPrUrl("");
        onSuccess?.();
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, [prUrl, onSuccess]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && prUrl.trim()) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, prUrl],
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          value={prUrl}
          onChange={(e) => {
            setPrUrl(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="https://github.com/owner/repo/pull/123"
          className="w-full bg-background border border-border rounded-md px-3 py-2 pl-9 text-text-primary text-xs placeholder:text-text-secondary/50 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
          disabled={loading}
          autoFocus
        />
        <GitPullRequest className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary" />
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading || !prUrl.trim()}
        className="w-full bg-accent/15 text-accent text-xs font-medium rounded-md px-3 py-2 hover:bg-accent/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
      >
        {loading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Fetching PR...
          </>
        ) : (
          <>
            <ExternalLink className="w-3.5 h-3.5" />
            Review PR
          </>
        )}
      </button>

      {error && <p className="text-danger text-xs">{error}</p>}

      <p className="text-text-secondary text-[10px]">
        Also accepts <code className="text-accent/70">owner/repo#123</code> format
      </p>
    </div>
  );
}
