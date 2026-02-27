import { useState, useEffect, useRef, useCallback } from "react";
import { GitBranch, GitCommit, ChevronDown, Loader2, RotateCcw, X } from "lucide-react";
import { useReviewStore } from "../../store/review";
import { useHttpApi } from "../../hooks/useHttpApi";
import type { GitRefsPayload } from "../../types";

export function RefSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [refs, setRefs] = useState<GitRefsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"branches" | "commits">("branches");
  const popoverRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const { activeSessionId, compareRef, setCompareRef, metadata } = useReviewStore();
  const { isAvailable, fetchRefs, compareAgainst } = useHttpApi();

  const displayRef = compareRef ?? "working copy";

  const handleOpen = useCallback(async () => {
    if (!activeSessionId) return;
    setIsOpen(true);
    setFilter("");
    setLoading(true);
    const data = await fetchRefs(activeSessionId);
    setRefs(data);
    setLoading(false);
  }, [activeSessionId, fetchRefs]);

  const handleSelect = useCallback(
    async (ref: string) => {
      if (!activeSessionId) return;
      setComparing(true);
      const success = await compareAgainst(activeSessionId, ref);
      if (success) {
        setCompareRef(ref);
      }
      setComparing(false);
      setIsOpen(false);
    },
    [activeSessionId, compareAgainst, setCompareRef],
  );

  const handleReset = useCallback(async () => {
    if (!activeSessionId) return;
    setComparing(true);
    const success = await compareAgainst(activeSessionId, "working-copy");
    if (success) {
      setCompareRef(null);
    }
    setComparing(false);
    setIsOpen(false);
  }, [activeSessionId, compareAgainst, setCompareRef]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Focus filter on open
  useEffect(() => {
    if (isOpen && filterRef.current) {
      filterRef.current.focus();
    }
  }, [isOpen]);

  if (!isAvailable) {
    // Non-server mode — show static badge
    if (!metadata?.currentBranch) return null;
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-neutral/15 text-neutral border border-neutral/30 font-mono">
        <GitBranch className="w-3 h-3" />
        {metadata.currentBranch}
      </span>
    );
  }

  const lowerFilter = filter.toLowerCase();

  const filteredLocalBranches =
    refs?.branches.local.filter((b) => b.toLowerCase().includes(lowerFilter)) ?? [];
  const filteredRemoteBranches =
    refs?.branches.remote.filter((b) => b.toLowerCase().includes(lowerFilter)) ?? [];
  const filteredCommits =
    refs?.commits.filter(
      (c) =>
        c.shortHash.toLowerCase().includes(lowerFilter) ||
        c.subject.toLowerCase().includes(lowerFilter) ||
        c.author.toLowerCase().includes(lowerFilter),
    ) ?? [];

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger badge */}
      <button
        onClick={() => (isOpen ? setIsOpen(false) : handleOpen())}
        disabled={comparing}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-neutral/15 text-neutral border border-neutral/30 font-mono hover:bg-neutral/25 transition-colors cursor-pointer disabled:opacity-50"
        title="Compare against a different ref"
      >
        {comparing ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <GitBranch className="w-3 h-3" />
        )}
        <span className="max-w-[180px] truncate">{displayRef}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute top-full mt-1 right-0 z-50 w-80 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-border">
            <input
              ref={filterRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter branches or commits..."
              className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab("branches")}
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "branches"
                  ? "text-accent border-b-2 border-accent"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <GitBranch className="w-3 h-3 inline mr-1" />
              Branches
            </button>
            <button
              onClick={() => setActiveTab("commits")}
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "commits"
                  ? "text-accent border-b-2 border-accent"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <GitCommit className="w-3 h-3 inline mr-1" />
              Commits
            </button>
          </div>

          {/* Content */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-text-secondary" />
                <span className="ml-2 text-xs text-text-secondary">Loading refs...</span>
              </div>
            ) : activeTab === "branches" ? (
              <div>
                {filteredLocalBranches.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary bg-background/50">
                      Local
                    </div>
                    {filteredLocalBranches.map((branch) => (
                      <button
                        key={branch}
                        onClick={() => handleSelect(branch)}
                        className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 hover:bg-text-primary/5 transition-colors cursor-pointer ${
                          compareRef === branch ? "bg-accent/10 text-accent" : "text-text-primary"
                        }`}
                      >
                        <GitBranch className="w-3 h-3 flex-shrink-0 text-text-secondary" />
                        <span className="font-mono truncate">{branch}</span>
                        {branch === refs?.currentBranch && (
                          <span className="ml-auto text-[10px] text-text-secondary">current</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {filteredRemoteBranches.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary bg-background/50">
                      Remote
                    </div>
                    {filteredRemoteBranches.map((branch) => (
                      <button
                        key={branch}
                        onClick={() => handleSelect(branch)}
                        className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 hover:bg-text-primary/5 transition-colors cursor-pointer ${
                          compareRef === branch ? "bg-accent/10 text-accent" : "text-text-primary"
                        }`}
                      >
                        <GitBranch className="w-3 h-3 flex-shrink-0 text-text-secondary" />
                        <span className="font-mono truncate">{branch}</span>
                      </button>
                    ))}
                  </div>
                )}

                {filteredLocalBranches.length === 0 && filteredRemoteBranches.length === 0 && (
                  <div className="px-3 py-4 text-xs text-text-secondary text-center">
                    No branches found
                  </div>
                )}
              </div>
            ) : (
              <div>
                {filteredCommits.length > 0 ? (
                  filteredCommits.map((commit) => (
                    <button
                      key={commit.hash}
                      onClick={() => handleSelect(commit.hash)}
                      className={`w-full px-3 py-1.5 text-xs text-left flex items-start gap-2 hover:bg-text-primary/5 transition-colors cursor-pointer ${
                        compareRef === commit.hash
                          ? "bg-accent/10 text-accent"
                          : "text-text-primary"
                      }`}
                    >
                      <GitCommit className="w-3 h-3 flex-shrink-0 mt-0.5 text-text-secondary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-accent">{commit.shortHash}</span>
                          <span className="truncate">{commit.subject}</span>
                        </div>
                        <div className="text-[10px] text-text-secondary mt-0.5">
                          {commit.author} &middot; {formatRelativeTime(commit.date)}
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-xs text-text-secondary text-center">
                    No commits found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reset link */}
          {compareRef && (
            <div className="border-t border-border p-2">
              <button
                onClick={handleReset}
                className="w-full px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary flex items-center justify-center gap-1.5 rounded hover:bg-text-primary/5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset to working copy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
