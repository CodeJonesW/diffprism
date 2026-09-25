/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AgentSettingsControl } from "../components/AgentSettings";

// #226: choosing the agent that answers PR review comments.
describe("AgentSettingsControl", () => {
  const fetchMock = vi.fn();
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
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

  it("shows the saved agent and model", async () => {
    fetchMock.mockResolvedValueOnce(respond({ settings: { agent: "claude", models: { claude: "opus" } } }));
    render(<AgentSettingsControl />);

    expect(await screen.findByRole("button", { name: "Review agent: Claude Code · opus" })).toBeDefined();
  });

  it("saves a different agent with its own model", async () => {
    fetchMock.mockResolvedValueOnce(respond({ settings: { agent: "claude", models: { claude: "opus" } } }));
    render(<AgentSettingsControl />);
    await open();

    fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
    // Each agent keeps its own model: Cursor's field starts empty.
    const model = screen.getByPlaceholderText("Cursor's default") as HTMLInputElement;
    expect(model.value).toBe("");
    fireEvent.change(model, { target: { value: "gpt-5" } });

    fetchMock.mockResolvedValueOnce(respond({ settings: { agent: "cursor", models: { claude: "opus", cursor: "gpt-5" } } }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Saved")).toBeDefined());
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("http://localhost:2/api/settings/agent");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ agent: "cursor", models: { claude: "opus", cursor: "gpt-5" } });
    expect(screen.getByRole("button", { name: "Review agent: Cursor · gpt-5" })).toBeDefined();
  });

  it("shows why saving failed, and keeps what was chosen", async () => {
    fetchMock.mockResolvedValueOnce(respond({ settings: { agent: "claude", models: { claude: "opus" } } }));
    render(<AgentSettingsControl />);
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));

    fetchMock.mockResolvedValueOnce(respond({ error: "disk full" }, 400));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("disk full");
    expect((screen.getByRole("radio", { name: "Cursor" }) as HTMLInputElement).checked).toBe(true);
  });

  // Settings the server can't read are the reviewer's to fix, not to be papered over.
  it("says why the settings can't be read", async () => {
    fetchMock.mockResolvedValueOnce(respond({ error: 'config.json: agent.default is "copilot"' }, 500));
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
