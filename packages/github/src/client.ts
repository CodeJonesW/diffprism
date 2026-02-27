import { Octokit } from "@octokit/rest";

export interface PrMetadata {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  body: string | null;
}

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Create an authenticated Octokit client.
 */
export function createGitHubClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

/**
 * Fetch PR metadata (title, author, branches, etc.).
 */
export async function fetchPullRequest(
  client: Octokit,
  owner: string,
  repo: string,
  number: number,
): Promise<PrMetadata> {
  const { data } = await client.pulls.get({ owner, repo, pull_number: number });

  return {
    owner,
    repo,
    number,
    title: data.title,
    author: data.user?.login ?? "unknown",
    url: data.html_url,
    baseBranch: data.base.ref,
    headBranch: data.head.ref,
    body: data.body,
  };
}

/**
 * Fetch the unified diff for a pull request.
 */
export async function fetchPullRequestDiff(
  client: Octokit,
  owner: string,
  repo: string,
  number: number,
): Promise<string> {
  const { data } = await client.pulls.get({
    owner,
    repo,
    pull_number: number,
    mediaType: { format: "diff" },
  });

  // With mediaType diff, data is the raw diff string
  return data as unknown as string;
}

/**
 * Parse a PR reference string into owner/repo/number.
 *
 * Accepts:
 *   - owner/repo#123
 *   - https://github.com/owner/repo/pull/123
 */
export function parsePrRef(input: string): PrRef {
  // Try URL format: https://github.com/owner/repo/pull/123
  const urlMatch = input.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      number: parseInt(urlMatch[3], 10),
    };
  }

  // Try shorthand: owner/repo#123
  const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      number: parseInt(shortMatch[3], 10),
    };
  }

  throw new Error(
    `Invalid PR reference: "${input}". ` +
      `Expected "owner/repo#123" or "https://github.com/owner/repo/pull/123"`,
  );
}
