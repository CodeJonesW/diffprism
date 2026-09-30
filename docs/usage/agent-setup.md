# Agent Setup Guide

**For AI coding agents** — Claude Code, Cursor, or any agent with a shell. A user who hands you
[diffprism.com](https://diffprism.com), [the GitHub repo](https://github.com/CodeJonesW/diffprism)
or [the npm package](https://www.npmjs.com/package/diffprism) and asks you to set DiffPrism up
wants you to follow this page. Run the commands yourself. Ask the user only the questions
below, and only the ones you can't answer by looking.

Your shell has no terminal, so none of these commands asks you anything. `diffprism setup`
creates a missing `.gitignore` without asking. The same command in the user's own terminal is
interactive: it asks about the `.gitignore`, then opens a sample review that waits for the browser.

## 1. Check prerequisites

```bash
node --version    # needs v20 or later
git --version
```

If Node is missing or older than 20, stop and tell the user. Don't install Node for them.

## 2. Ask the user

Work out what you can first, then ask the rest in one message, with the default each one gets if they don't care.

| Question | Find out first with | Default |
|----------|---------------------|---------|
| Which coding agent do you use DiffPrism from: Claude Code, Cursor, or both? | `command -v claude cursor cursor-agent`, and `ls -d ~/.claude ~/.cursor` — the editor alone leaves only the folder. Ask only if you find both or neither | The one you are |
| Which repositories should it be set up in? | The repo you're running in | That repo only |
| Should commits in those repos open a review first when they're large (120+ staged lines)? See [Commit Gate](../../README.md#commit-gate). | — | No |
| Which agent should answer comments on pull request reviews? | — | Claude Code, unless only Cursor is installed |

Reviewing GitHub pull requests also needs GitHub access. Check it, don't ask:

```bash
gh auth status
```

If that fails and `GITHUB_TOKEN` isn't set, tell the user to run `gh auth login` themselves. It's interactive.
Local reviews work without it.

## 3. Install

```bash
npm install -g diffprism
diffprism --version
```

If a global install fails on permissions, tell the user rather than reaching for `sudo`.

## 4. Configure

### Claude Code

Once per machine, then once in each repository the user chose:

```bash
diffprism setup --global    # the /review skill and tool permissions, in ~/.claude
cd <repo>
diffprism setup             # .mcp.json, project permissions, /review skill, .gitignore entries
```

`diffprism setup` never overwrites what's there. It merges into existing files and skips what's
already configured, so it's safe to run again.

### Cursor

`diffprism setup` configures Claude Code only. For Cursor, add DiffPrism's MCP server to
`.cursor/mcp.json` in each chosen repository, or to `~/.cursor/mcp.json` for every project.
Merge it into `mcpServers` if the file already exists:

```json
{
  "mcpServers": {
    "diffprism": {
      "command": "npx",
      "args": ["diffprism@latest", "serve"]
    }
  }
}
```

Cursor asks before it runs each tool. The user can allow them from Cursor's MCP settings.

### Only if the user said yes

```bash
diffprism hook install                  # in each chosen repo: gate large commits on a review
diffprism config set agent cursor       # Cursor answers PR review comments instead of Claude Code
```

## 5. Verify

```bash
diffprism doctor
```

For a Claude Code setup, run it from a chosen repository. It checks the global and project
configuration against the installed version, and ends with `Everything matches this version.`
It exits 1 while something is out of date. `diffprism doctor --fix` updates it, as setup would.
It doesn't check Cursor's `mcp.json`, so read that file back instead.

## 6. Hand over

Tell the user:

- **Restart the agent.** Claude Code and Cursor load MCP servers when they start, so DiffPrism's
  tools, and the `/review` skill, appear after a restart. That includes the session you're in.
- **Try it.** `diffprism demo` opens a sample review in the browser. It waits until the user
  submits it, so run it in the background or leave it to them.
- **Use it.** `diffprism review <PR URL>` reviews a pull request. In Claude Code, `/review` reviews
  the changes in progress.

To undo everything:

```bash
diffprism teardown              # in each repo: Claude Code's project config
diffprism hook uninstall        # in each repo that has the commit gate
diffprism teardown --global     # the global skill and permissions
diffprism config unset agent    # if you chose Cursor for PR reviews
```

Then remove the `diffprism` entry from any Cursor `mcp.json` you added it to.

For the MCP tools, manual configuration and troubleshooting, see the [Claude Code Setup Guide](claude-setup.md).
