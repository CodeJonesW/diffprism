import { useMemo, useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  parseDiff,
  Diff,
  Hunk as DiffHunk,
  tokenize,
  getChangeKey,
  isInsert,
  isDelete,
  isNormal,
} from "react-diff-view";
import type { ChangeData, HunkData, GutterOptions, ChangeEventArgs, EventMap } from "react-diff-view";
import { refractor } from "refractor";
import { useReviewStore } from "../../store/review";
import { FileCode, Columns2, Rows2, HelpCircle } from "lucide-react";
import { InlineCommentForm, InlineCommentThread, InlineAnnotationThread } from "../InlineComment";
import { ThemeToggle } from "../ThemeToggle";
import { getFileKey, getDisplayPath } from "../../lib/file-key";

/**
 * Adapter for refractor v4 to work with react-diff-view's tokenize function.
 *
 * react-diff-view expects `refractor.highlight(code, lang)` to return an array
 * of HAST nodes (the old refractor v2 API). Refractor v4 returns a Root node
 * with a `.children` property. This wrapper unwraps it.
 */
const refractorAdapter = {
  highlight(code: string, language: string) {
    const root = refractor.highlight(code, language);
    return root.children;
  },
  registered(language: string) {
    return refractor.registered(language);
  },
};

/**
 * Map common file extensions / language names to refractor grammar names.
 */
function mapLanguage(lang: string): string | null {
  const map: Record<string, string> = {
    typescript: "typescript",
    ts: "typescript",
    tsx: "tsx",
    javascript: "javascript",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    css: "css",
    html: "markup",
    xml: "markup",
    markdown: "markdown",
    md: "markdown",
    python: "python",
    py: "python",
    rust: "rust",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    "c++": "cpp",
    csharp: "csharp",
    "c#": "csharp",
    ruby: "ruby",
    rb: "ruby",
    php: "php",
    shell: "bash",
    bash: "bash",
    sh: "bash",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    graphql: "graphql",
    scss: "scss",
    sass: "sass",
    less: "less",
    swift: "swift",
    kotlin: "kotlin",
    scala: "scala",
    lua: "lua",
    r: "r",
    perl: "perl",
    diff: "diff",
  };

  return map[lang.toLowerCase()] ?? null;
}

/**
 * Get the relevant line number from a change for comment mapping.
 * For inserts and normal changes, use the new line number.
 * For deletes, use the old line number.
 */
function getLineFromChange(change: ChangeData): number {
  if (isInsert(change)) return change.lineNumber;
  if (isDelete(change)) return change.lineNumber;
  if (isNormal(change)) return change.newLineNumber;
  return 0;
}

/**
 * Build a mapping from "file:line" to change keys for widget placement.
 */
function buildLineToKeyMap(
  hunks: HunkData[],
  filePath: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      const line = getLineFromChange(change);
      const compositeKey = `${filePath}:${line}`;
      if (!map[compositeKey]) {
        map[compositeKey] = getChangeKey(change);
      }
    }
  }
  return map;
}

/**
 * Extract the raw diff text for a single file from the full rawDiff string.
 *
 * @param occurrence - 0-based index for when the same file path appears
 *   multiple times in the rawDiff (e.g. staged + unstaged). Defaults to 0.
 */
function extractFileDiff(rawDiff: string, filePath: string, occurrence = 0): string | null {
  // Match diff sections starting with "diff --git"
  const diffPattern = /^diff --git /gm;
  const matches: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = diffPattern.exec(rawDiff)) !== null) {
    matches.push(match.index);
  }

  let found = 0;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1] : rawDiff.length;
    const section = rawDiff.slice(start, end);

    // Check if this section is for the file we're looking for.
    // The diff header can be:
    //   diff --git a/path b/path
    //   diff --git a/old-path b/new-path  (for renames)
    if (
      section.includes(`a/${filePath}`) ||
      section.includes(`b/${filePath}`)
    ) {
      if (found === occurrence) {
        return section;
      }
      found++;
    }
  }

  return null;
}

export function DiffViewer() {
  const {
    diffSet,
    rawDiff,
    selectedFile,
    viewMode,
    setViewMode,
    comments,
    activeCommentKey,
    addComment,
    updateComment,
    deleteComment,
    setActiveCommentKey,
    toggleHotkeyGuide,
    focusedHunkIndex,
    setHunkCount,
    annotations,
    dismissAnnotation,
  } = useReviewStore();

  const selectedDiffFile = useMemo(() => {
    if (!diffSet || !selectedFile) return null;
    return diffSet.files.find((f) => getFileKey(f) === selectedFile) ?? null;
  }, [diffSet, selectedFile]);

  const fileDiffText = useMemo(() => {
    if (!rawDiff || !selectedFile || !diffSet) return null;
    const displayPath = getDisplayPath(selectedFile);
    // Count how many files with the same path appear before the selected file
    // to determine which occurrence to extract from rawDiff
    let occurrence = 0;
    for (const f of diffSet.files) {
      if (getFileKey(f) === selectedFile) break;
      if (f.path === displayPath) occurrence++;
    }
    return extractFileDiff(rawDiff, displayPath, occurrence);
  }, [rawDiff, selectedFile, diffSet]);

  const parsedFiles = useMemo(() => {
    if (!fileDiffText) return [];
    try {
      return parseDiff(fileDiffText);
    } catch {
      return [];
    }
  }, [fileDiffText]);

  const tokens = useMemo(() => {
    if (parsedFiles.length === 0 || !selectedDiffFile) return undefined;

    const lang = mapLanguage(selectedDiffFile.language);
    if (!lang) return undefined;

    // Verify refractor supports this language
    try {
      if (!refractorAdapter.registered(lang)) return undefined;
    } catch {
      return undefined;
    }

    try {
      const options = {
        refractor: refractorAdapter,
        highlight: true as const,
        language: lang,
      };
      return tokenize(parsedFiles[0].hunks, options);
    } catch {
      // Syntax highlighting is best-effort
      return undefined;
    }
  }, [parsedFiles, selectedDiffFile, viewMode]);

  // Map of "fileKey:line" → changeKey for the current file
  const lineToKeyMap = useMemo(() => {
    if (parsedFiles.length === 0 || !selectedFile) return {};
    return buildLineToKeyMap(parsedFiles[0].hunks, selectedFile);
  }, [parsedFiles, selectedFile]);

  // Reverse map: changeKey → line number
  const keyToLineMap = useMemo(() => {
    if (parsedFiles.length === 0) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    for (const hunk of parsedFiles[0].hunks) {
      for (const change of hunk.changes) {
        map[getChangeKey(change)] = getLineFromChange(change);
      }
    }
    return map;
  }, [parsedFiles]);

  // Comments for the currently selected file
  const fileComments = useMemo(() => {
    if (!selectedFile) return [];
    return comments
      .map((c, i) => ({ comment: c, index: i }))
      .filter((c) => c.comment.file === selectedFile);
  }, [comments, selectedFile]);

  // Annotations for the currently selected file (non-dismissed only)
  // Annotations use raw paths (e.g. "src/foo.ts") while selectedFile may have
  // a stage prefix (e.g. "unstaged:src/foo.ts"), so compare via display path.
  const fileAnnotations = useMemo(() => {
    if (!selectedFile) return [];
    const displayPath = getDisplayPath(selectedFile);
    return annotations.filter(
      (a) => a.file === displayPath && !a.dismissed,
    );
  }, [annotations, selectedFile]);

  // Annotations grouped by line number
  const annotationsByLine = useMemo(() => {
    const map = new Map<number, typeof fileAnnotations>();
    for (const a of fileAnnotations) {
      if (!map.has(a.line)) map.set(a.line, []);
      map.get(a.line)!.push(a);
    }
    return map;
  }, [fileAnnotations]);

  // Gutter click handler — toggle comment form for the clicked line
  const gutterEvents: EventMap = useMemo(
    () => ({
      onClick({ change }: ChangeEventArgs) {
        if (!change) return;
        const key = getChangeKey(change);
        setActiveCommentKey(activeCommentKey === key ? null : key);
      },
    }),
    [activeCommentKey, setActiveCommentKey],
  );

  // Custom gutter renderer — show "+" on hover, indicators for comments/annotations
  const renderGutter = useCallback(
    ({ change, inHoverState, renderDefault }: GutterOptions) => {
      const line = getLineFromChange(change);
      const hasComments =
        selectedFile &&
        fileComments.some((c) => c.comment.line === line);
      const hasAnnotations = annotationsByLine.has(line);

      if (inHoverState) {
        return (
          <>
            <span className="diff-gutter-add-comment">+</span>
            {renderDefault()}
          </>
        );
      }

      if (hasComments) {
        return (
          <>
            <span className="diff-comment-indicator" />
            {renderDefault()}
          </>
        );
      }

      if (hasAnnotations) {
        return (
          <>
            <span className="diff-annotation-indicator" />
            {renderDefault()}
          </>
        );
      }

      return renderDefault();
    },
    [selectedFile, fileComments, annotationsByLine],
  );

  // Build widgets — inline comment threads, annotation threads, and/or open forms
  const widgets = useMemo(() => {
    if (!selectedFile) return {};
    const w: Record<string, ReactNode> = {};

    // Group file comments by line
    const commentsByLine = new Map<number, { comment: typeof comments[0]; index: number }[]>();
    for (const fc of fileComments) {
      const line = fc.comment.line;
      if (!commentsByLine.has(line)) commentsByLine.set(line, []);
      commentsByLine.get(line)!.push(fc);
    }

    // Collect all lines that have either comments or annotations
    const allLines = new Set<number>([
      ...commentsByLine.keys(),
      ...annotationsByLine.keys(),
    ]);

    // Render widgets for lines with existing comments and/or annotations
    for (const line of allLines) {
      const changeKey = lineToKeyMap[`${selectedFile}:${line}`];
      if (!changeKey) continue;

      const lineComments = commentsByLine.get(line);
      const lineAnnotations = annotationsByLine.get(line);

      w[changeKey] = (
        <>
          {lineAnnotations && lineAnnotations.length > 0 && (
            <InlineAnnotationThread
              annotations={lineAnnotations}
              onDismiss={dismissAnnotation}
            />
          )}
          {lineComments && lineComments.length > 0 && (
            <InlineCommentThread
              comments={lineComments}
              isFormOpen={activeCommentKey === changeKey}
              file={selectedFile}
              line={line}
              onAdd={(body, type) => {
                addComment({ file: selectedFile, line, body, type });
              }}
              onUpdate={(index, body, type) => {
                updateComment(index, { file: selectedFile, line, body, type });
              }}
              onDelete={deleteComment}
              onOpenForm={() => setActiveCommentKey(changeKey)}
              onCloseForm={() => setActiveCommentKey(null)}
            />
          )}
        </>
      );
    }

    // Render standalone form for active key with no existing content
    if (activeCommentKey && !w[activeCommentKey]) {
      const line = keyToLineMap[activeCommentKey];
      if (line !== undefined) {
        w[activeCommentKey] = (
          <div className="border-t border-border bg-surface">
            <InlineCommentForm
              onSave={(body, type) => {
                addComment({ file: selectedFile, line, body, type });
                setActiveCommentKey(null);
              }}
              onCancel={() => setActiveCommentKey(null)}
            />
          </div>
        );
      }
    }

    return w;
  }, [
    selectedFile,
    fileComments,
    fileAnnotations,
    annotationsByLine,
    activeCommentKey,
    lineToKeyMap,
    keyToLineMap,
    addComment,
    updateComment,
    deleteComment,
    dismissAnnotation,
    setActiveCommentKey,
  ]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sync hunk count to the store whenever the parsed file changes
  useEffect(() => {
    setHunkCount(parsedFiles[0]?.hunks.length ?? 0);
  }, [parsedFiles, setHunkCount]);

  // Scroll to focused hunk and apply visual highlight
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || focusedHunkIndex === null) return;

    const hunkElements = container.querySelectorAll("tbody.diff-hunk");
    hunkElements.forEach((el) => el.classList.remove("diff-hunk-focused"));

    if (hunkElements[focusedHunkIndex]) {
      hunkElements[focusedHunkIndex].scrollIntoView({ behavior: "smooth", block: "center" });
      hunkElements[focusedHunkIndex].classList.add("diff-hunk-focused");
    }
  }, [focusedHunkIndex]);

  // Listen for "c" key via custom event — open comment on first change in focused hunk
  useEffect(() => {
    function handleOpenComment() {
      if (focusedHunkIndex === null || parsedFiles.length === 0 || !selectedFile) return;
      const hunk = parsedFiles[0].hunks[focusedHunkIndex];
      if (!hunk || hunk.changes.length === 0) return;

      const firstChange = hunk.changes[0];
      const key = getChangeKey(firstChange);
      setActiveCommentKey(key);
    }

    document.addEventListener("diffprism:open-comment", handleOpenComment);
    return () => document.removeEventListener("diffprism:open-comment", handleOpenComment);
  }, [focusedHunkIndex, parsedFiles, selectedFile, setActiveCommentKey]);

  // No file selected state
  if (!selectedFile || !diffSet) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <FileCode className="w-12 h-12 text-text-secondary/40 mx-auto mb-3" />
          <p className="text-text-secondary text-sm">
            Select a file to view changes
          </p>
        </div>
      </div>
    );
  }

  const displayPath = getDisplayPath(selectedFile);

  // Binary file state
  if (selectedDiffFile?.binary) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <FileHeader path={displayPath} stage={selectedDiffFile?.stage} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-text-secondary text-sm">
              Binary file — cannot display diff
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No diff data available
  if (parsedFiles.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <FileHeader path={displayPath} stage={selectedDiffFile?.stage} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-text-secondary text-sm">
              No diff content available for this file
            </p>
          </div>
        </div>
      </div>
    );
  }

  const diffData = parsedFiles[0];

  return (
    <div className="flex-1 flex flex-col bg-background min-h-0">
      <FileHeader
        path={displayPath}
        stage={selectedDiffFile?.stage}
        additions={selectedDiffFile?.additions}
        deletions={selectedDiffFile?.deletions}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onToggleHotkeyGuide={toggleHotkeyGuide}
      />
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <Diff
          viewType={viewMode}
          diffType={diffData.type}
          hunks={diffData.hunks}
          tokens={tokens}
          widgets={widgets}
          gutterEvents={gutterEvents}
          renderGutter={renderGutter}
        >
          {(hunks) =>
            hunks.map((hunk) => (
              <DiffHunk key={hunk.content} hunk={hunk} />
            ))
          }
        </Diff>
      </div>
    </div>
  );
}

function FileHeader({
  path,
  stage,
  additions,
  deletions,
  viewMode,
  onViewModeChange,
  onToggleHotkeyGuide,
}: {
  path: string;
  stage?: "staged" | "unstaged";
  additions?: number;
  deletions?: number;
  viewMode?: "unified" | "split";
  onViewModeChange?: (mode: "unified" | "split") => void;
  onToggleHotkeyGuide?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-surface border-b border-border flex-shrink-0">
      <FileCode className="w-4 h-4 text-text-secondary flex-shrink-0" />
      <span className="text-text-primary text-sm font-mono truncate">
        {path}
      </span>
      {stage && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
          stage === "staged"
            ? "bg-green-600/20 text-green-400 border-green-500/30"
            : "bg-yellow-600/20 text-yellow-400 border-yellow-500/30"
        }`}>
          {stage === "staged" ? "Staged" : "Unstaged"}
        </span>
      )}
      <div className="flex items-center gap-2 ml-auto flex-shrink-0">
        {additions !== undefined && additions > 0 && (
          <span className="text-green-700 dark:text-green-400 text-xs font-mono">
            +{additions}
          </span>
        )}
        {deletions !== undefined && deletions > 0 && (
          <span className="text-red-700 dark:text-red-400 text-xs font-mono">
            -{deletions}
          </span>
        )}
        {viewMode && onViewModeChange && (
          <div className="flex items-center rounded border border-border ml-2">
            <button
              onClick={() => onViewModeChange("unified")}
              className={`p-1 ${
                viewMode === "unified"
                  ? "bg-text-primary/10 text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
              title="Unified view"
            >
              <Rows2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange("split")}
              className={`p-1 ${
                viewMode === "split"
                  ? "bg-text-primary/10 text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
              title="Split view"
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {onToggleHotkeyGuide && (
          <button
            onClick={onToggleHotkeyGuide}
            className="p-1.5 rounded text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            title="Keyboard shortcuts (?)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        )}
        <ThemeToggle />
      </div>
    </div>
  );
}
