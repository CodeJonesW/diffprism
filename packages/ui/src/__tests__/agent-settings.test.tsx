/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { modelFamily } from "../components/AgentSettings";
import { SettingsControl } from "../components/Settings";
import { useReviewStore } from "../store/review";

// #226: choosing the agent that answers PR review comments.
// #244: choosing its model from the list its own CLI gives.
// #290: in a Settings modal, beside the dojo's skills (and out of the narrow sidebar, #259).
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn();
/** What reading the agent settings answers, every time it's asked. */
let agentGet: () => Response;
/** What saving answers, in order. */
let puts: Response[];
/** What reading the dojo's settings answers. */
let dojoGet: () => Response;
let models: Record<string, () => Response | Promise<Response>>;

beforeEach(() => {
  agentGet = () => respond({ settings: { agent: "claude", models: { claude: "opus" } } });
  puts = [];
  dojoGet = () => respond({ skills: [], chosen: [] });
  models = {
    claude: () => respond({ models: [{ id: "fable", label: "Fable (latest)" }, { id: "opus", label: "Opus (latest)" }] }),
    cursor: () =>
      respond({
        models: [
          { id: "auto", label: "Auto" },
          { id: "gpt-5.3-codex", label: "Codex 5.3" },
          { id: "gpt-5.3-codex-high-fast", label: "Codex 5.3 High Fast" },
        ],
      }),
  };
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const next = puts.shift();
      if (!next) throw new Error(`unexpected save: ${url}`);
      return next;
    }
    if (url.includes("/api/settings/agent/models")) return models[new URL(url).searchParams.get("agent")!]();
    if (url.includes("/api/settings/agent")) return agentGet();
    if (url.includes("/api/settings/dojo")) return dojoGet();
    throw new Error(`unexpected call: ${url}`);
  });
  window.history.replaceState(null, "", "/?httpPort=2");
  useReviewStore.setState({ reviewId: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async (summary: RegExp = /Review agent: Claude Code · opus/) => {
  fireEvent.click(await screen.findByRole("button", { name: summary }));
  return screen.getByRole("dialog", { name: "Settings" });
};
const putBody = () => {
  const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
  return JSON.parse(String((call![1] as RequestInit).body));
};

describe("Settings: the review agent", () => {
  it("shows the saved agent and model on the button", async () => {
    render(<SettingsControl />);
    expect(await screen.findByRole("button", { name: "Settings · Review agent: Claude Code · opus" })).toBeDefined();
  });

  it("picks a different agent's model from the list its CLI gives, and saves it", async () => {
    render(<SettingsControl />);
    await open();

    fireEvent.click(await screen.findByRole("radio", { name: "Cursor" }));
    // Each agent keeps its own model: Cursor's starts at its default.
    const model = (await screen.findByRole("combobox", { name: "Model for Cursor" })) as HTMLSelectElement;
    expect(model.value).toBe("");
    fireEvent.change(model, { target: { value: "gpt-5.3-codex" } });

    puts.push(respond({ settings: { agent: "cursor", models: { claude: "opus", cursor: "gpt-5.3-codex" } } }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Saved")).toBeDefined());
    expect(putBody()).toEqual({ agent: "cursor", models: { claude: "opus", cursor: "gpt-5.3-codex" } });
    expect(screen.getByRole("button", { name: /Review agent: Cursor · gpt-5.3-codex/ })).toBeDefined();
  });

  it("ignores a list that comes back after switching to another agent", async () => {
    let claudeReplies = (_r: Response) => {};
    const slowClaude = models.claude;
    models.claude = () => new Promise<Response>((resolve) => (claudeReplies = resolve));
    render(<SettingsControl />);
    await open();

    fireEvent.click(await screen.findByRole("radio", { name: "Cursor" }));
    const model = await screen.findByRole("combobox", { name: "Model for Cursor" });
    claudeReplies(slowClaude() as Response);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(model).queryByRole("option", { name: /fable/ })).toBeNull();
    expect(within(model).getByRole("option", { name: "Codex 5.3 (gpt-5.3-codex)" })).toBeDefined();
  });

  it("groups a long list by model family", async () => {
    agentGet = () => respond({ settings: { agent: "cursor", models: {} } });
    render(<SettingsControl />);
    await open(/Review agent: Cursor/);
    const model = await screen.findByRole("combobox", { name: "Model for Cursor" });

    const groups = [...model.querySelectorAll("optgroup")].map((g) => [g.label, g.querySelectorAll("option").length]);
    expect(groups).toEqual([
      ["auto", 1],
      ["gpt-5.3-codex", 2],
    ]);
    expect(within(model).getByRole("option", { name: "Other…" })).toBeDefined();
  });

  it("takes a model the list doesn't name, typed in under Other…", async () => {
    render(<SettingsControl />);
    await open();

    fireEvent.change(await screen.findByRole("combobox", { name: "Model for Claude Code" }), { target: { value: "__other__" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model for Claude Code" }), { target: { value: "claude-fable-5" } });

    puts.push(respond({ settings: { agent: "claude", models: { claude: "claude-fable-5" } } }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeDefined());
    expect(putBody()).toEqual({ agent: "claude", models: { claude: "claude-fable-5" } });
  });

  it("keeps a saved model the list doesn't name as it was typed, rather than losing it", async () => {
    agentGet = () => respond({ settings: { agent: "claude", models: { claude: "claude-fable-5" } } });
    render(<SettingsControl />);
    await open(/Review agent: Claude Code · claude-fable-5/);

    expect(((await screen.findByRole("textbox", { name: "Model for Claude Code" })) as HTMLInputElement).value).toBe("claude-fable-5");
  });

  it("falls back to typing it in, and says why, when the agent can't list its models", async () => {
    models.cursor = () => respond({ error: "Couldn't ask `cursor-agent` for its models: spawn cursor-agent ENOENT" }, 502);
    agentGet = () => respond({ settings: { agent: "cursor", models: {} } });
    render(<SettingsControl />);
    await open(/Review agent: Cursor/);

    expect(await screen.findByRole("textbox", { name: "Model for Cursor" })).toBeDefined();
    expect(screen.getByText(/Couldn't list models: Couldn't ask `cursor-agent` for its models/)).toBeDefined();
  });

  it("shows why saving failed, and keeps what was chosen", async () => {
    render(<SettingsControl />);
    await open();
    fireEvent.click(await screen.findByRole("radio", { name: "Cursor" }));
    await screen.findByRole("combobox", { name: "Model for Cursor" });

    puts.push(respond({ error: "disk full" }, 400));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("disk full");
    expect((screen.getByRole("radio", { name: "Cursor" }) as HTMLInputElement).checked).toBe(true);
  });

  // Settings the server can't read are the reviewer's to fix, not to be papered over.
  it("says why the settings can't be read", async () => {
    agentGet = () => respond({ error: 'config.json: agent.default is "copilot"' }, 500);
    render(<SettingsControl />);
    await open(/^Settings$/);
    expect((await screen.findByRole("alert")).textContent).toContain('agent.default is "copilot"');
  });

  it("does nothing without a server", () => {
    window.history.replaceState(null, "", "/");
    render(<SettingsControl />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Settings: the modal (#290, #259)", () => {
  it("opens from the sidebar with room for every section, and closes on Escape or the close button", async () => {
    render(<SettingsControl />);
    const dialog = await open();
    expect(within(dialog).getByRole("region", { name: "Review agent" })).toBeDefined();
    expect(within(dialog).getByRole("region", { name: "Dojo skills" })).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();

    await open();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });
});

describe("Settings: the dojo's skills (#290)", () => {
  const skills = [
    { id: "user:security-review", scope: "user", name: "Security review", description: "Look for injection" },
    { id: "project:house-style", scope: "project", name: "House style" },
  ];

  it("lists yours and the open review's repository's, and saves the ones ticked", async () => {
    useReviewStore.setState({ reviewId: "s1" });
    dojoGet = () => respond({ skills, chosen: ["user:security-review"] });
    render(<SettingsControl />);
    await open();

    const section = await screen.findByRole("region", { name: "Dojo skills" });
    const security = await within(section).findByRole("checkbox", { name: /Security review/ });
    expect((security as HTMLInputElement).checked).toBe(true);
    expect(within(section).getByText("Yours (~/.claude/skills)")).toBeDefined();
    fireEvent.click(within(section).getByRole("checkbox", { name: /House style/ }));

    puts.push(respond({ chosen: ["user:security-review", "project:house-style"] }));
    fireEvent.click(within(section).getByRole("button", { name: "Save skills" }));

    await waitFor(() => expect(within(section).getByText("Saved")).toBeDefined());
    expect(putBody()).toEqual({ skills: ["user:security-review", "project:house-style"] });
    // Asked about the review that's open, so its repository's skills are there.
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:2/api/settings/dojo?session=s1");
  });

  it("says where skills go when there are none", async () => {
    render(<SettingsControl />);
    await open();
    expect(await screen.findByText(/No skills found\. A skill is a folder holding a/)).toBeDefined();
  });

  it("says so when a skill of yours that's chosen is gone, and keeps other repositories' for them", async () => {
    dojoGet = () =>
      respond({ skills: [skills[0]], chosen: ["user:security-review", "user:gone", "project:house-style@/work/other-repo"] });
    render(<SettingsControl />);
    await open();
    expect(await screen.findByText("Chosen but not found: gone. The dojo won't start until you choose again.")).toBeDefined();
    expect(screen.getByText(/Also chosen for other repositories, and used only in their local reviews: house-style\./)).toBeDefined();
  });

  it("ignores a list that comes back after the open review changed", async () => {
    let firstReplies: (r: Response) => void = () => {};
    useReviewStore.setState({ reviewId: "s1" });
    dojoGet = () => new Promise<Response>((resolve) => (firstReplies = resolve)) as unknown as Response;
    render(<SettingsControl />);
    await open();

    dojoGet = () => respond({ skills: [skills[0]], chosen: [] });
    useReviewStore.setState({ reviewId: "s2" });
    expect(await screen.findByRole("checkbox", { name: /Security review/ })).toBeDefined();

    // s1's reply, late, with another repository's skill.
    firstReplies(respond({ skills: [skills[1]], chosen: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("checkbox", { name: /House style/ })).toBeNull();
  });
});

describe("modelFamily", () => {
  it("drops the effort level and speed", () => {
    expect(modelFamily("gpt-5.3-codex-high-fast")).toBe("gpt-5.3-codex");
    expect(modelFamily("gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(modelFamily("claude-opus-5-5-max")).toBe("claude-opus-5-5");
    expect(modelFamily("auto")).toBe("auto");
  });
});
