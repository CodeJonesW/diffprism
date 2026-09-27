/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { AgentSettingsControl, modelFamily } from "../components/AgentSettings";

// #226: choosing the agent that answers PR review comments.
// #244: choosing its model from the list its own CLI gives.
describe("AgentSettingsControl", () => {
  const fetchMock = vi.fn();
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  /** What the settings endpoint answers, in order; the models endpoint answers by agent. */
  let settings: Response[];
  let models: Record<string, () => Response | Promise<Response>>;

  beforeEach(() => {
    settings = [];
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
    fetchMock.mockImplementation(async (url: string) => {
      const agent = new URL(url).searchParams.get("agent");
      if (url.includes("/api/settings/agent/models")) return models[agent!]();
      const next = settings.shift();
      if (!next) throw new Error(`unexpected settings call: ${url}`);
      return next;
    });
    window.history.replaceState(null, "", "/?httpPort=2");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const open = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /Review agent: Claude Code · opus/ }));
    return screen.getByRole("dialog", { name: "Review agent" });
  };
  const putBody = () => {
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    return JSON.parse(String((call![1] as RequestInit).body));
  };

  it("shows the saved agent and model", async () => {
    settings.push(respond({ settings: { agent: "claude", models: { claude: "opus" } } }));
    render(<AgentSettingsControl />);

    expect(await screen.findByRole("button", { name: "Review agent: Claude Code · opus" })).toBeDefined();
  });

  it("picks a different agent's model from the list its CLI gives, and saves it", async () => {
    settings.push(respond({ settings: { agent: "claude", models: { claude: "opus" } } }));
    render(<AgentSettingsControl />);
    await open();

    fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
    // Each agent keeps its own model: Cursor's starts at its default.
    const model = (await screen.findByRole("combobox", { name: "Model for Cursor" })) as HTMLSelectElement;
    expect(model.value).toBe("");
    fireEvent.change(model, { target: { value: "gpt-5.3-codex" } });

    settings.push(respond({ settings: { agent: "cursor", models: { claude: "opus", cursor: "gpt-5.3-codex" } } }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Saved")).toBeDefined());
    expect(putBody()).toEqual({ agent: "cursor", models: { claude: "opus", cursor: "gpt-5.3-codex" } });
    expect(screen.getByRole("button", { name: "Review agent: Cursor · gpt-5.3-codex" })).toBeDefined();
  });

  it("ignores a list that comes back after switching to another agent", async () => {
    let claudeReplies = (_r: Response) => {};
    const slowClaude = models.claude;
    models.claude = () => new Promise<Response>((resolve) => (claudeReplies = resolve));
    settings.push(respond({ settings: { agent: "claude", models: { claude: "opus" } } }));
    render(<AgentSettingsControl />);
    await open();

    fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
    const model = await screen.findByRole("combobox", { name: "Model for Cursor" });
    claudeReplies(slowClaude() as Response);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(model).queryByRole("option", { name: /fable/ })).toBeNull();
    expect(within(model).getByRole("option", { name: "Codex 5.3 (gpt-5.3-codex)" })).toBeDefined();
  });

  it("groups a long list by model family", async () => {
    settings.push(respond({ settings: { agent: "cursor", models: {} } }));
    render(<AgentSettingsControl />);
    fireEvent.click(await screen.findByRole("button", { name: "Review agent: Cursor" }));
    const model = await screen.findByRole("combobox", { name: "Model for Cursor" });

    const groups = [...model.querySelectorAll("optgroup")].map((g) => [g.label, g.querySelectorAll("option").length]);
    expect(groups).toEqual([
      ["auto", 1],
      ["gpt-5.3-codex", 2],
    ]);
    expect(within(model).getByRole("option", { name: "Other…" })).toBeDefined();
  });

  it("takes a model the list doesn't name, typed in under Other…", async () => {
    settings.push(respond({ settings: { agent: "claude", models: { claude: "opus" } } }));
    render(<AgentSettingsControl />);
    await open();

    fireEvent.change(await screen.findByRole("combobox", { name: "Model for Claude Code" }), { target: { value: "__other__" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model for Claude Code" }), { target: { value: "claude-fable-5" } });

    settings.push(respond({ settings: { agent: "claude", models: { claude: "claude-fable-5" } } }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeDefined());
    expect(putBody()).toEqual({ agent: "claude", models: { claude: "claude-fable-5" } });
  });

  it("keeps a saved model the list doesn't name as it was typed, rather than losing it", async () => {
    settings.push(respond({ settings: { agent: "claude", models: { claude: "claude-fable-5" } } }));
    render(<AgentSettingsControl />);
    fireEvent.click(await screen.findByRole("button", { name: /Review agent: Claude Code · claude-fable-5/ }));

    expect(((await screen.findByRole("textbox", { name: "Model for Claude Code" })) as HTMLInputElement).value).toBe("claude-fable-5");
  });

  it("falls back to typing it in, and says why, when the agent can't list its models", async () => {
    models.cursor = () => respond({ error: "Couldn't ask `cursor-agent` for its models: spawn cursor-agent ENOENT" }, 502);
    settings.push(respond({ settings: { agent: "cursor", models: {} } }));
    render(<AgentSettingsControl />);
    fireEvent.click(await screen.findByRole("button", { name: "Review agent: Cursor" }));

    expect(await screen.findByRole("textbox", { name: "Model for Cursor" })).toBeDefined();
    expect(screen.getByText(/Couldn't list models: Couldn't ask `cursor-agent` for its models/)).toBeDefined();
  });

  it("shows why saving failed, and keeps what was chosen", async () => {
    settings.push(respond({ settings: { agent: "claude", models: { claude: "opus" } } }));
    render(<AgentSettingsControl />);
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
    await screen.findByRole("combobox", { name: "Model for Cursor" });

    settings.push(respond({ error: "disk full" }, 400));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("disk full");
    expect((screen.getByRole("radio", { name: "Cursor" }) as HTMLInputElement).checked).toBe(true);
  });

  // Settings the server can't read are the reviewer's to fix, not to be papered over.
  it("says why the settings can't be read", async () => {
    settings.push(respond({ error: 'config.json: agent.default is "copilot"' }, 500));
    render(<AgentSettingsControl />);

    fireEvent.click(await screen.findByRole("button", { name: "Review agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain('agent.default is "copilot"');
  });

  it("does nothing without a server", () => {
    window.history.replaceState(null, "", "/");
    render(<AgentSettingsControl />);
    expect(screen.queryByRole("button")).toBeNull();
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
