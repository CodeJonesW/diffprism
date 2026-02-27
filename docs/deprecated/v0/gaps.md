 High Priority

  1. "Post to GitHub" checkbox does nothing — UI sets postToGithub on ReviewResult but server
  never reads it
  2. Annotation dismissals are local-only — not persisted to server, not broadcast to other
  clients, lost on refresh
  3. Review history has no UI or API — data is recorded to disk but nothing reads it
  4. Quick actions not wired end-to-end — "Approve & Commit" sets postReviewAction but no
  server-side handling

  Medium Priority

  5. GitHub PR history writes to nonsense path — github:owner/repo/.diffprism/... creates
  literal directory
  6. RefSelector shown but broken for GitHub PRs — renders but all operations fail silently
  7. No error feedback for ref comparison failures — selector just closes on error
  8. Only notifies on new sessions — no notification for review submitted, diff updated, etc.
  9. Annotation body truncated with no expand — long text cut off by CSS

  Low Priority

  10. No system color-scheme detection — defaults to dark, ignores OS preference
  11. 'c' shortcut fails silently when no hunk focused
  12. DiffPoller errors silently swallowed — git failures during polling are invisible

  Which one do you want to tackle first? I'd suggest #1 (Post to GitHub checkbox) or #2
  (annotation dismissals) since they're both clear bugs where existing UI features don't
  actually work.

  Deprecated on Feb 27, 2026