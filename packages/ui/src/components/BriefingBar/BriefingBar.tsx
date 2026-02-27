import { useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Package,
  FolderOpen,
  FlaskConical,
  Gauge,
  ShieldAlert,
  Search,
  GitPullRequest,
  ExternalLink,
} from "lucide-react";
import { useReviewStore } from "../../store/review";
import { RefSelector } from "../RefSelector";
import { BRIEFING_BADGE_STYLES, BRIEFING_SECTION_COLORS, SEVERITY_BADGE_STYLES, SEVERITY_COLORS } from "../../lib/semantic-colors";

export function BriefingBar() {
  const [expanded, setExpanded] = useState(false);
  const { briefing, metadata, isServerMode, clearReview } = useReviewStore();

  if (!briefing) return null;
  
  const { impact, verification, complexity, testCoverage, patterns } = briefing;
  const hasBreaking = impact.breakingChanges.length > 0;
  const hasNewDeps = impact.newDependencies.length > 0;
  const moduleCount = impact.affectedModules.length;
  const highComplexity = complexity?.filter((c) => c.score >= 5) ?? [];
  const coverageGaps = testCoverage?.filter((t) => t.testFile === null) ?? [];
  const securityFlags = patterns?.filter((p) => p.severity) ?? [];
  const nonSecurityPatterns = patterns?.filter((p) => !p.severity) ?? [];
  const patternCount = nonSecurityPatterns.length;

  return (
    <div className="bg-surface border-b border-border flex-shrink-0">
      {/* Collapsed row */}
      <div className="flex items-center">
        {isServerMode && (
          <button
            onClick={clearReview}
            className="px-3 py-2.5 text-text-secondary hover:text-text-primary transition-colors cursor-pointer border-r border-border"
            title="Back to sessions"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-text-primary/5 transition-colors"
        >
          <span className="text-text-primary text-sm flex-1 text-left truncate">
            {briefing.summary}
          </span>

        <div className="flex items-center gap-2 flex-shrink-0">
          {securityFlags.length > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${BRIEFING_BADGE_STYLES.security}`}>
              <ShieldAlert className="w-3 h-3" />
              {securityFlags.length} security flag{securityFlags.length !== 1 ? "s" : ""}
            </span>
          )}

          {moduleCount > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${BRIEFING_BADGE_STYLES.modules}`}>
              <FolderOpen className="w-3 h-3" />
              {moduleCount} module{moduleCount !== 1 ? "s" : ""}
            </span>
          )}

          {hasBreaking && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${BRIEFING_BADGE_STYLES.breaking}`}>
              <AlertTriangle className="w-3 h-3" />
              breaking
            </span>
          )}

          {hasNewDeps && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${BRIEFING_BADGE_STYLES.deps}`}>
              <Package className="w-3 h-3" />
              {impact.newDependencies.length} new dep
              {impact.newDependencies.length !== 1 ? "s" : ""}
            </span>
          )}

          {highComplexity.length > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${BRIEFING_BADGE_STYLES.complexity}`}>
              <Gauge className="w-3 h-3" />
              {highComplexity.length} complex
            </span>
          )}

          {coverageGaps.length > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${BRIEFING_BADGE_STYLES.coverage}`}>
              <ShieldAlert className="w-3 h-3" />
              {coverageGaps.length} untested
            </span>
          )}

          {patternCount > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${BRIEFING_BADGE_STYLES.patterns}`}>
              <Search className="w-3 h-3" />
              {patternCount} pattern{patternCount !== 1 ? "s" : ""}
            </span>
          )}

          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-secondary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-secondary" />
          )}
        </div>
      </button>
      <div className="px-3 py-2.5 border-l border-border flex-shrink-0">
        <RefSelector />
      </div>
      </div>

      {/* GitHub PR context */}
      {metadata?.githubPr && (
        <div className="px-4 py-2 border-t border-border/50 flex items-center gap-3 text-xs">
          <GitPullRequest className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          <span className="text-text-primary font-medium truncate">
            {metadata.githubPr.owner}/{metadata.githubPr.repo}#{metadata.githubPr.number}
          </span>
          <span className="text-text-secondary">by {metadata.githubPr.author}</span>
          <span className="text-text-secondary font-mono">
            {metadata.githubPr.baseBranch} ← {metadata.githubPr.headBranch}
          </span>
          <a
            href={metadata.githubPr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-accent hover:text-accent/80 transition-colors flex-shrink-0"
          >
            View on GitHub
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border/50 pt-3">
          {/* Security Flags */}
          {securityFlags.length > 0 && (
            <div className="col-span-2">
              <h4 className={`${BRIEFING_SECTION_COLORS.security} text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5`}>
                <ShieldAlert className="w-3.5 h-3.5" />
                Security Flags
              </h4>
              <ul className="space-y-0.5">
                {securityFlags.map((p, i) => (
                  <li key={`${p.file}:${p.line}:${i}`} className="text-xs">
                    <span
                      className={`inline-block px-1 py-0.5 rounded text-[10px] font-medium uppercase mr-1.5 ${
                        SEVERITY_BADGE_STYLES[p.severity ?? "warning"]
                      }`}
                    >
                      {p.pattern.replace("_", " ")}
                    </span>
                    <span
                      className={`text-[10px] font-medium uppercase mr-1.5 ${
                        SEVERITY_COLORS[p.severity ?? "warning"]
                      }`}
                    >
                      {p.severity}
                    </span>
                    <span className="font-mono text-text-secondary">
                      {p.file}:{p.line}
                    </span>
                    <span className="text-text-secondary ml-1 truncate">
                      — {p.content}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
              <h4 className={`${BRIEFING_SECTION_COLORS.breaking} text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5`}>
                <AlertTriangle className="w-3.5 h-3.5" />
                Breaking Changes
              </h4>
              <ul className="space-y-0.5">
                {impact.breakingChanges.map((bc) => (
                  <li key={bc} className="text-danger text-xs">
                    {bc}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* New Dependencies */}
          {hasNewDeps && (
            <div>
              <h4 className={`${BRIEFING_SECTION_COLORS.deps} text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5`}>
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
              <h4 className={`${BRIEFING_SECTION_COLORS.complexity} text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5`}>
                <Gauge className="w-3.5 h-3.5" />
                High Complexity
              </h4>
              <ul className="space-y-0.5">
                {highComplexity.map((c) => (
                  <li key={c.path} className="text-text-primary text-xs">
                    <span className="font-mono">{c.path}</span>
                    <span className="text-perf ml-1">({c.score}/10)</span>
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
              <h4 className={`${BRIEFING_SECTION_COLORS.coverage} text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5`}>
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
          {nonSecurityPatterns.length > 0 && (
            <div>
              <h4 className={`${BRIEFING_SECTION_COLORS.patterns} text-xs font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5`}>
                <Search className="w-3.5 h-3.5" />
                Pattern Flags
              </h4>
              <ul className="space-y-0.5">
                {nonSecurityPatterns.map((p, i) => (
                  <li key={`${p.file}:${p.line}:${i}`} className="text-xs">
                    <span className={`inline-block px-1 py-0.5 rounded text-[10px] font-medium uppercase mr-1.5 ${BRIEFING_BADGE_STYLES.patterns}`}>
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
      className={`text-xs ${value ? "text-success" : "text-danger"}`}
    >
      {label}: <span className="font-mono">{value ? "pass" : "fail"}</span>
    </span>
  );
}
