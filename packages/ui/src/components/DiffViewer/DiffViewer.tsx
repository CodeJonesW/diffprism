import { useMemo } from "react";
import { parseDiff, Diff, Hunk as DiffHunk, tokenize } from "react-diff-view";
import { refractor } from "refractor";
import { useReviewStore } from "../../store/review";
import { FileCode } from "lucide-react";

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
 * Extract the raw diff text for a single file from the full rawDiff string.
 */
function extractFileDiff(rawDiff: string, filePath: string): string | null {
  // Match diff sections starting with "diff --git"
  const diffPattern = /^diff --git /gm;
  const matches: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = diffPattern.exec(rawDiff)) !== null) {
    matches.push(match.index);
  }

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
      return section;
    }
  }

  return null;
}

export function DiffViewer() {
  const { diffSet, rawDiff, selectedFile } = useReviewStore();

  const selectedDiffFile = useMemo(() => {
    if (!diffSet || !selectedFile) return null;
    return diffSet.files.find((f) => f.path === selectedFile) ?? null;
  }, [diffSet, selectedFile]);

  const fileDiffText = useMemo(() => {
    if (!rawDiff || !selectedFile) return null;
    return extractFileDiff(rawDiff, selectedFile);
  }, [rawDiff, selectedFile]);

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
  }, [parsedFiles, selectedDiffFile]);

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

  // Binary file state
  if (selectedDiffFile?.binary) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <FileHeader path={selectedFile} />
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
        <FileHeader path={selectedFile} />
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
        path={selectedFile}
        additions={selectedDiffFile?.additions}
        deletions={selectedDiffFile?.deletions}
      />
      <div className="flex-1 overflow-auto">
        <Diff viewType="unified" diffType={diffData.type} hunks={diffData.hunks} tokens={tokens}>
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
  additions,
  deletions,
}: {
  path: string;
  additions?: number;
  deletions?: number;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-surface border-b border-border flex-shrink-0">
      <FileCode className="w-4 h-4 text-text-secondary flex-shrink-0" />
      <span className="text-text-primary text-sm font-mono truncate">
        {path}
      </span>
      {(additions !== undefined || deletions !== undefined) && (
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {additions !== undefined && additions > 0 && (
            <span className="text-green-400 text-xs font-mono">
              +{additions}
            </span>
          )}
          {deletions !== undefined && deletions > 0 && (
            <span className="text-red-400 text-xs font-mono">
              -{deletions}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
