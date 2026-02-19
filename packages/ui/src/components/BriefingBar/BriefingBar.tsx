import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Package,
  FolderOpen,
  FlaskConical,
  Gauge,
  ShieldAlert,
  Search,
  GitBranch,
} from "lucide-react";
import { useReviewStore } from "../../store/review";

export function BriefingBar() {
  const [expanded, setExpanded] = useState(false);
  const { briefing, metadata } = useReviewStore();

  if (!briefing) return null;
  
  const { impact, verification, complexity, testCoverage, patterns } = briefing;
  const hasBreaking = impact.breakingChanges.length > 0;
  const hasNewDeps = impact.newDependencies.length > 0;
  const moduleCount = impact.affectedModules.length;
  const highComplexity = complexity?.filter((c) => c.score >= 5) ?? [];
  const coverageGaps = testCoverage?.filter((t) => t.testFile === null) ?? [];
  const patternCount = patterns?.length ?? 0;

  return (
    <div className="bg-surface border-b border-border flex-shrink-0">
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-text-primary/5 transition-colors"
      >
        <span className="text-text-primary text-sm flex-1 text-left truncate">
          {briefing.summary}
        </span>

        <div className="flex items-center gap-2 flex-shrink-0">
          {metadata?.currentBranch && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-600/20 text-gray-400 border border-gray-500/30 font-mono">
              <GitBranch className="w-3 h-3" />
              {metadata.currentBranch}
            </span>
          )}

          {moduleCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <FolderOpen className="w-3 h-3" />
              {moduleCount} module{moduleCount !== 1 ? "s" : ""}
            </span>
          )}

          {hasBreaking && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-600/20 text-red-400 border border-red-500/30">
              <AlertTriangle className="w-3 h-3" />
              breaking
            </span>
          )}

          {hasNewDeps && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-600/20 text-yellow-400 border border-yellow-500/30">
              <Package className="w-3 h-3" />
              {impact.newDependencies.length} new dep
              {impact.newDependencies.length !== 1 ? "s" : ""}
            </span>
          )}

          {highComplexity.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-orange-600/20 text-orange-400 border border-orange-500/30">
              <Gauge className="w-3 h-3" />
              {highComplexity.length} complex
            </span>
          )}

          {coverageGaps.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-600/20 text-yellow-400 border border-yellow-500/30">
              <ShieldAlert className="w-3 h-3" />
              {coverageGaps.length} untested
            </span>
          )}

          {patternCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-600/20 text-purple-400 border border-purple-500/30">
              <Search className="w-3 h-3" />
              {patternCount} flag{patternCount !== 1 ? "s" : ""}
            </span>
          )}

          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-secondary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-secondary" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border/50 pt-3">
          {/* Affected Modules */}
          {impact.affectedModules.length > 0 && (
            <div>
              <h4 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5" />
                Affected Modules
              </h4>
              <ul className="space-y-0.5">
                {impact.affectedModules.map((mod) => (
                  <li
                    key={mod}
                    className="text-text-primary text-xs font-mono"
                  >
                    {mod}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Affected Tests */}
          {impact.affectedTests.length > 0 && (
            <div>
              <h4 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5" />
                Affected Tests
              </h4>
              <ul className="space-y-0.5">
                {impact.affectedTests.map((t) => (
                  <li
                    key={t}
                    className="text-text-primary text-xs font-mono truncate"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Breaking Changes */}
          {hasBreaking && (
            <div>
              <h4 className="text-red-400 text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Breaking Changes
              </h4>
              <ul className="space-y-0.5">
                {impact.breakingChanges.map((bc) => (
                  <li key={bc} className="text-red-400 text-xs">
                    {bc}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* New Dependencies */}
          {hasNewDeps && (
            <div>
              <h4 className="text-yellow-400 text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" />
                New Dependencies
              </h4>
              <ul className="space-y-0.5">
                {impact.newDependencies.map((dep) => (
                  <li
                    key={dep}
                    className="text-text-primary text-xs font-mono"
                  >
                    {dep}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* High Complexity */}
          {highComplexity.length > 0 && (
            <div>
              <h4 className="text-orange-400 text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" />
                High Complexity
              </h4>
              <ul className="space-y-0.5">
                {highComplexity.map((c) => (
                  <li key={c.path} className="text-text-primary text-xs">
                    <span className="font-mono">{c.path}</span>
                    <span className="text-orange-400 ml-1">({c.score}/10)</span>
                    {c.factors.length > 0 && (
                      <span className="text-text-secondary ml-1">
                        — {c.factors.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Test Coverage Gaps */}
          {coverageGaps.length > 0 && (
            <div>
              <h4 className="text-yellow-400 text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                Missing Test Changes
              </h4>
              <ul className="space-y-0.5">
                {coverageGaps.map((gap) => (
                  <li
                    key={gap.sourceFile}
                    className="text-text-primary text-xs font-mono"
                  >
                    {gap.sourceFile}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pattern Flags */}
          {patterns && patterns.length > 0 && (
            <div>
              <h4 className="text-purple-400 text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" />
                Pattern Flags
              </h4>
              <ul className="space-y-0.5">
                {patterns.map((p, i) => (
                  <li key={`${p.file}:${p.line}:${i}`} className="text-xs">
                    <span className="inline-block px-1 py-0.5 rounded text-[10px] font-medium uppercase mr-1.5 bg-purple-600/20 text-purple-400 border border-purple-500/30">
                      {p.pattern}
                    </span>
                    <span className="font-mono text-text-secondary">
                      {p.file}
                      {p.line > 0 ? `:${p.line}` : ""}
                    </span>
                    {p.line > 0 && (
                      <span className="text-text-secondary ml-1 truncate">
                        — {p.content}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verification */}
          <div>
            <h4 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5" />
              Verification
            </h4>
            <div className="flex items-center gap-3">
              <VerificationBadge label="Tests" value={verification.testsPass} />
              <VerificationBadge
                label="Types"
                value={verification.typeCheck}
              />
              <VerificationBadge label="Lint" value={verification.lintClean} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VerificationBadge({
  label,
  value,
}: {
  label: string;
  value: boolean | null;
}) {
  if (value === null) {
    return (
      <span className="text-text-secondary text-xs">
        {label}: <span className="font-mono">—</span>
      </span>
    );
  }

  return (
    <span
      className={`text-xs ${value ? "text-green-400" : "text-red-400"}`}
    >
      {label}: <span className="font-mono">{value ? "pass" : "fail"}</span>
    </span>
  );
}
