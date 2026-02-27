import { parseDiff } from "@diffprism/git";
import { analyze } from "@diffprism/analysis";
import type {
  DiffSet,
  ReviewBriefing,
  ReviewInitPayload,
  ReviewMetadata,
  GitHubPrMetadata,
} from "@diffprism/core";
import type { PrMetadata } from "./client.js";

export interface NormalizedPr {
  diffSet: DiffSet;
  rawDiff: string;
  briefing: ReviewBriefing;
  metadata: ReviewMetadata;
  payload: ReviewInitPayload;
}

/**
 * Normalize a GitHub PR's raw diff and metadata into DiffPrism types.
 *
 * Calls parseDiff() from @diffprism/git on the raw unified diff, then
 * runs analyze() from @diffprism/analysis to produce a ReviewBriefing.
 */
export function normalizePr(
  rawDiff: string,
  prMetadata: PrMetadata,
  options?: { title?: string; reasoning?: string },
): NormalizedPr {
  const diffSet = parseDiff(rawDiff, prMetadata.baseBranch, prMetadata.headBranch);
  const briefing = analyze(diffSet);

  const githubPr: GitHubPrMetadata = {
    owner: prMetadata.owner,
    repo: prMetadata.repo,
    number: prMetadata.number,
    title: prMetadata.title,
    author: prMetadata.author,
    url: prMetadata.url,
    baseBranch: prMetadata.baseBranch,
    headBranch: prMetadata.headBranch,
  };

  const metadata: ReviewMetadata = {
    title: options?.title ?? `PR #${prMetadata.number}: ${prMetadata.title}`,
    description: prMetadata.body ?? undefined,
    reasoning: options?.reasoning,
    currentBranch: prMetadata.headBranch,
    githubPr,
  };

  const payload: ReviewInitPayload = {
    reviewId: "",
    diffSet,
    rawDiff,
    briefing,
    metadata,
  };

  return { diffSet, rawDiff, briefing, metadata, payload };
}
