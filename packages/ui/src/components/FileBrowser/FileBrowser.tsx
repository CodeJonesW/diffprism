import { useEffect, useCallback } from "react";
import { useReviewStore } from "../../store/review";
import {
  FileCode,
  FilePlus,
  FileMinus,
  FilePenLine,
  Eye,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import type { DiffFile, FileReviewStatus } from "../../types";

function getStatusBadge(status: DiffFile["status"]) {
  switch (status) {
    case "added":
      return {
        label: "A",
        className: "bg-green-600/20 text-green-400 border-green-500/30",
      };
    case "modified":
      return {
        label: "M",
        className: "bg-yellow-600/20 text-yellow-400 border-yellow-500/30",
      };
    case "deleted":
      return {
        label: "D",
        className: "bg-red-600/20 text-red-400 border-red-500/30",
      };
    case "renamed":
      return {
        label: "R",
        className: "bg-purple-600/20 text-purple-400 border-purple-500/30",
      };
  }
}

function getStatusIcon(status: DiffFile["status"]) {
  const iconClass = "w-4 h-4 flex-shrink-0";
  switch (status) {
    case "added":
      return <FilePlus className={`${iconClass} text-green-400`} />;
    case "deleted":
      return <FileMinus className={`${iconClass} text-red-400`} />;
    case "modified":
      return <FilePenLine className={`${iconClass} text-yellow-400`} />;
    case "renamed":
      return <FileCode className={`${iconClass} text-purple-400`} />;
  }
}

function getReviewStatusIcon(status: FileReviewStatus) {
  const iconClass = "w-3.5 h-3.5 flex-shrink-0";
  switch (status) {
    case "unreviewed":
      return null;
    case "reviewed":
      return <Eye className={`${iconClass} text-blue-400`} />;
    case "approved":
      return <CheckCircle className={`${iconClass} text-green-400`} />;
    case "needs_changes":
      return <AlertCircle className={`${iconClass} text-yellow-400`} />;
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

export function FileBrowser() {
  const { diffSet, selectedFile, selectFile, fileStatuses, cycleFileStatus } =
    useReviewStore();

  const navigateFiles = useCallback(
    (direction: "up" | "down") => {
      if (!diffSet || diffSet.files.length === 0) return;

      const currentIndex = diffSet.files.findIndex(
        (f) => f.path === selectedFile,
      );
      let nextIndex: number;

      if (currentIndex === -1) {
        nextIndex = 0;
      } else if (direction === "up") {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex;
      } else {
        nextIndex =
          currentIndex < diffSet.files.length - 1
            ? currentIndex + 1
            : currentIndex;
      }

      selectFile(diffSet.files[nextIndex].path);
    },
    [diffSet, selectedFile, selectFile],
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
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigateFiles, selectedFile, cycleFileStatus]);

  if (!diffSet) return null;

  const totalAdditions = diffSet.files.reduce(
    (sum, f) => sum + f.additions,
    0,
  );
  const totalDeletions = diffSet.files.reduce(
    (sum, f) => sum + f.deletions,
    0,
  );

  return (
    <div className="flex flex-col h-full bg-surface border-r border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-text-primary text-sm font-semibold">Files</h2>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-text-secondary text-xs">
            {diffSet.files.length} file{diffSet.files.length !== 1 ? "s" : ""}
          </span>
          {totalAdditions > 0 && (
            <span className="text-green-400 text-xs font-mono">
              +{totalAdditions}
            </span>
          )}
          {totalDeletions > 0 && (
            <span className="text-red-400 text-xs font-mono">
              -{totalDeletions}
            </span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {diffSet.files.map((file) => {
          const isSelected = file.path === selectedFile;
          const badge = getStatusBadge(file.status);
          const dir = dirname(file.path);

          return (
            <button
              key={file.path}
              onClick={() => selectFile(file.path)}
              className={`
                w-full text-left px-3 py-2 flex items-center gap-2
                transition-colors duration-100 cursor-pointer group
                ${
                  isSelected
                    ? "bg-accent/10 border-l-2 border-accent"
                    : "border-l-2 border-transparent hover:bg-white/5"
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
                  <div className="text-xs text-text-secondary/60 truncate">
                    {dir}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {(() => {
                  const reviewStatus = fileStatuses[file.path] ?? "unreviewed";
                  const icon = getReviewStatusIcon(reviewStatus);
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleFileStatus(file.path);
                      }}
                      className={`p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer ${
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
                  <span className="text-green-400 text-xs font-mono">
                    +{file.additions}
                  </span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-400 text-xs font-mono">
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
        })}
      </div>
    </div>
  );
}
