import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useReviewStore } from "../../store/review";
import {
  FileCode,
  FilePlus,
  FileMinus,
  FilePenLine,
  Eye,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Check,
  GitPullRequest,
} from "lucide-react";
import type { DiffFile, FileReviewStatus, ReviewResult, PostReviewAction, AnnotatedChange } from "../../types";
import { getFileKey } from "../../lib/file-key";

function getStatusBadge(status: DiffFile["status"]) {
  switch (status) {
    case "added":
      return {
        label: "A",
        className: "bg-green-100 dark:bg-green-600/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-500/30",
      };
    case "modified":
      return {
        label: "M",
        className: "bg-yellow-100 dark:bg-yellow-600/20 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-500/30",
      };
    case "deleted":
      return {
        label: "D",
        className: "bg-red-100 dark:bg-red-600/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-500/30",
      };
    case "renamed":
      return {
        label: "R",
        className: "bg-purple-100 dark:bg-purple-600/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-500/30",
      };
  }
}

function getStatusIcon(status: DiffFile["status"]) {
  const iconClass = "w-4 h-4 flex-shrink-0";
  switch (status) {
    case "added":
      return <FilePlus className={`${iconClass} text-green-700 dark:text-green-400`} />;
    case "deleted":
      return <FileMinus className={`${iconClass} text-red-700 dark:text-red-400`} />;
    case "modified":
      return <FilePenLine className={`${iconClass} text-yellow-700 dark:text-yellow-400`} />;
    case "renamed":
      return <FileCode className={`${iconClass} text-purple-700 dark:text-purple-400`} />;
  }
}

function getReviewStatusIcon(status: FileReviewStatus) {
  const iconClass = "w-3.5 h-3.5 flex-shrink-0";
  switch (status) {
    case "unreviewed":
      return null;
    case "reviewed":
      return <Eye className={`${iconClass} text-blue-700 dark:text-blue-400`} />;
    case "approved":
      return <CheckCircle className={`${iconClass} text-green-700 dark:text-green-400`} />;
    case "needs_changes":
      return <AlertCircle className={`${iconClass} text-yellow-700 dark:text-yellow-400`} />;
  }
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

function dirname(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

interface FileBrowserProps {
  onSubmit: (result: ReviewResult) => void;
}

export function FileBrowser({ onSubmit }: FileBrowserProps) {
  const { diffSet, selectedFile, selectFile, fileStatuses, cycleFileStatus, toggleHotkeyGuide, comments, navigateHunk, setFileStatus, briefing } =
    useReviewStore();

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Determine if we're in grouped mode (files have stage set)
  const hasGroups = useMemo(() => {
    if (!diffSet) return false;
    return diffSet.files.some((f) => f.stage !== undefined);
  }, [diffSet]);

  const { stagedFiles, unstagedFiles } = useMemo(() => {
    if (!diffSet) return { stagedFiles: [], unstagedFiles: [] };
    if (!hasGroups) return { stagedFiles: [], unstagedFiles: [] };
    return {
      stagedFiles: diffSet.files.filter((f) => f.stage === "staged"),
      unstagedFiles: diffSet.files.filter((f) => f.stage === "unstaged"),
    };
  }, [diffSet, hasGroups]);

  // Triage grouping from briefing data
  const triageGroups = useMemo(() => {
    if (!diffSet || !briefing?.triage) return null;

    const { critical, notable, mechanical } = briefing.triage;
    const hasTriageData = critical.length > 0 || mechanical.length > 0;
    if (!hasTriageData) return null;

    const criticalPaths = new Set(critical.map((c: AnnotatedChange) => c.file));
    const mechanicalPaths = new Set(mechanical.map((m: AnnotatedChange) => m.file));

    const criticalFiles: DiffFile[] = [];
    const notableFiles: DiffFile[] = [];
    const mechanicalFiles: DiffFile[] = [];

    for (const file of diffSet.files) {
      if (criticalPaths.has(file.path)) {
        criticalFiles.push(file);
      } else if (mechanicalPaths.has(file.path)) {
        mechanicalFiles.push(file);
      } else {
        notableFiles.push(file);
      }
    }

    return { criticalFiles, notableFiles, mechanicalFiles };
  }, [diffSet, briefing]);

  const useTriageView = triageGroups !== null && !hasGroups;

  // Flat ordered list for keyboard navigation (respects groups)
  const flatFiles = useMemo(() => {
    if (!diffSet) return [];
    if (useTriageView && triageGroups) {
      const result: DiffFile[] = [];
      if (!collapsedSections["triage-critical"]) result.push(...triageGroups.criticalFiles);
      if (!collapsedSections["triage-notable"]) result.push(...triageGroups.notableFiles);
      if (!collapsedSections["triage-mechanical"]) result.push(...triageGroups.mechanicalFiles);
      return result;
    }
    if (!hasGroups) return diffSet.files;
    const result: DiffFile[] = [];
    if (!collapsedSections["staged"]) result.push(...stagedFiles);
    if (!collapsedSections["unstaged"]) result.push(...unstagedFiles);
    return result;
  }, [diffSet, hasGroups, stagedFiles, unstagedFiles, collapsedSections, useTriageView, triageGroups]);

  const navigateFiles = useCallback(
    (direction: "up" | "down") => {
      if (flatFiles.length === 0) return;

      const currentIndex = flatFiles.findIndex(
        (f) => getFileKey(f) === selectedFile,
      );
      let nextIndex: number;

      if (currentIndex === -1) {
        nextIndex = 0;
      } else if (direction === "up") {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex;
      } else {
        nextIndex =
          currentIndex < flatFiles.length - 1
            ? currentIndex + 1
            : currentIndex;
      }

      selectFile(getFileKey(flatFiles[nextIndex]));
    },
    [flatFiles, selectedFile, selectFile],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        navigateFiles("up");
      } else if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        navigateFiles("down");
      } else if (e.key === "s") {
        e.preventDefault();
        if (selectedFile) {
          cycleFileStatus(selectedFile);
        }
      } else if (e.key === "?") {
        e.preventDefault();
        toggleHotkeyGuide();
      } else if (e.key === "n") {
        e.preventDefault();
        navigateHunk("next");
      } else if (e.key === "p") {
        e.preventDefault();
        navigateHunk("prev");
      } else if (e.key === "c") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("diffprism:open-comment"));
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigateFiles, selectedFile, cycleFileStatus, toggleHotkeyGuide, navigateHunk]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const handleQuickAction = useCallback(
    (action: PostReviewAction) => {
      const hasStatuses = Object.values(fileStatuses).some(
        (s) => s !== "unreviewed",
      );
      onSubmit({
        decision: "approved",
        comments,
        fileStatuses: hasStatuses ? fileStatuses : undefined,
        postReviewAction: action,
      });
      setMenuOpen(false);
    },
    [fileStatuses, comments, onSubmit],
  );

  const handleBatchApproveMechanical = useCallback(() => {
    if (!triageGroups) return;
    for (const file of triageGroups.mechanicalFiles) {
      setFileStatus(getFileKey(file), "approved");
    }
  }, [triageGroups, setFileStatus]);

  if (!diffSet) return null;

  const totalAdditions = diffSet.files.reduce(
    (sum, f) => sum + f.additions,
    0,
  );
  const totalDeletions = diffSet.files.reduce(
    (sum, f) => sum + f.deletions,
    0,
  );

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const renderFileRow = (file: DiffFile) => {
    const key = getFileKey(file);
    const isSelected = key === selectedFile;
    const badge = getStatusBadge(file.status);
    const dir = dirname(file.path);

    return (
      <button
        key={key}
        onClick={() => selectFile(key)}
        className={`
          w-full text-left px-3 py-2 flex items-center gap-2
          transition-colors duration-100 cursor-pointer group
          ${
            isSelected
              ? "bg-accent/10 border-l-2 border-accent"
              : "border-l-2 border-transparent hover:bg-text-primary/5"
          }
        `}
      >
        {getStatusIcon(file.status)}

        <div className="flex-1 min-w-0">
          <div
            className={`text-sm truncate ${
              isSelected ? "text-text-primary" : "text-text-secondary"
            } group-hover:text-text-primary`}
          >
            {basename(file.path)}
          </div>
          {dir && (
            <div className="text-xs text-text-secondary/70 dark:text-text-secondary/90 truncate">
              {dir}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {(() => {
            const reviewStatus = fileStatuses[key] ?? "unreviewed";
            const icon = getReviewStatusIcon(reviewStatus);
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  cycleFileStatus(key);
                }}
                className={`p-0.5 rounded hover:bg-text-primary/10 transition-colors cursor-pointer ${
                  icon
                    ? ""
                    : "opacity-0 group-hover:opacity-40"
                }`}
                title={
                  icon
                    ? `Status: ${reviewStatus} (click to cycle)`
                    : "Mark as reviewed (click to cycle)"
                }
              >
                {icon ?? (
                  <Eye className="w-3.5 h-3.5 text-text-secondary" />
                )}
              </button>
            );
          })()}
          {file.additions > 0 && (
            <span className="text-green-700 dark:text-green-400 text-xs font-mono">
              +{file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-700 dark:text-red-400 text-xs font-mono">
              -{file.deletions}
            </span>
          )}
          <span
            className={`
              text-[10px] font-bold px-1.5 py-0.5 rounded border
              ${badge.className}
            `}
          >
            {badge.label}
          </span>
        </div>
      </button>
    );
  };

  const renderSectionHeader = (
    label: string,
    sectionKey: string,
    files: DiffFile[],
  ) => {
    const isCollapsed = collapsedSections[sectionKey] ?? false;
    const additions = files.reduce((sum, f) => sum + f.additions, 0);
    const deletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return (
      <button
        key={`section-${sectionKey}`}
        onClick={() => toggleSection(sectionKey)}
        className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-text-primary/5 cursor-pointer"
      >
        {isCollapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-text-secondary flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-secondary flex-shrink-0" />
        )}
        <span className="text-text-secondary text-xs font-semibold uppercase tracking-wide">
          {label} ({files.length})
        </span>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {additions > 0 && (
            <span className="text-green-700 dark:text-green-400 text-xs font-mono">
              +{additions}
            </span>
          )}
          {deletions > 0 && (
            <span className="text-red-700 dark:text-red-400 text-xs font-mono">
              -{deletions}
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface border-r border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-text-primary text-sm font-semibold">Files</h2>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="p-1 rounded hover:bg-text-primary/10 transition-colors cursor-pointer text-text-secondary hover:text-text-primary"
              title="Quick actions"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-surface border border-border rounded-lg shadow-lg z-50 py-1">
                <button
                  onClick={() => handleQuickAction("commit")}
                  className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-text-primary/10 flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Check className="w-4 h-4 text-green-700 dark:text-green-400" />
                  Approve & Commit
                </button>
                <button
                  onClick={() => handleQuickAction("commit_and_pr")}
                  className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-text-primary/10 flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <GitPullRequest className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                  Approve, Commit & PR
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-text-secondary text-xs">
            {diffSet.files.length} file{diffSet.files.length !== 1 ? "s" : ""}
          </span>
          {totalAdditions > 0 && (
            <span className="text-green-700 dark:text-green-400 text-xs font-mono">
              +{totalAdditions}
            </span>
          )}
          {totalDeletions > 0 && (
            <span className="text-red-700 dark:text-red-400 text-xs font-mono">
              -{totalDeletions}
            </span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {useTriageView && triageGroups ? (
          <>
            {triageGroups.criticalFiles.length > 0 && (
              <>
                {renderSectionHeader("Critical", "triage-critical", triageGroups.criticalFiles)}
                {!collapsedSections["triage-critical"] &&
                  triageGroups.criticalFiles.map(renderFileRow)}
              </>
            )}
            {triageGroups.notableFiles.length > 0 && (
              <>
                {renderSectionHeader("Notable", "triage-notable", triageGroups.notableFiles)}
                {!collapsedSections["triage-notable"] &&
                  triageGroups.notableFiles.map(renderFileRow)}
              </>
            )}
            {triageGroups.mechanicalFiles.length > 0 && (
              <>
                <div className="flex items-center">
                  <div className="flex-1">
                    {renderSectionHeader("Mechanical", "triage-mechanical", triageGroups.mechanicalFiles)}
                  </div>
                  <button
                    onClick={handleBatchApproveMechanical}
                    className="mr-3 text-[10px] font-medium text-green-600 dark:text-green-400 hover:text-green-500 cursor-pointer px-1.5 py-0.5 rounded border border-green-600/30 dark:border-green-400/30 hover:bg-green-500/10"
                  >
                    Approve all
                  </button>
                </div>
                {!collapsedSections["triage-mechanical"] &&
                  triageGroups.mechanicalFiles.map(renderFileRow)}
              </>
            )}
          </>
        ) : hasGroups ? (
          <>
            {stagedFiles.length > 0 && (
              <>
                {renderSectionHeader("Staged Changes", "staged", stagedFiles)}
                {!collapsedSections["staged"] && stagedFiles.map(renderFileRow)}
              </>
            )}
            {unstagedFiles.length > 0 && (
              <>
                {renderSectionHeader("Changes", "unstaged", unstagedFiles)}
                {!collapsedSections["unstaged"] && unstagedFiles.map(renderFileRow)}
              </>
            )}
          </>
        ) : (
          diffSet.files.map(renderFileRow)
        )}
      </div>
    </div>
  );
}
