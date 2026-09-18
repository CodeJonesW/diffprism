// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/** A fresh store, reading whatever layout localStorage holds right now — as a reload would. */
async function loadStore() {
  vi.resetModules();
  const { useReviewStore } = await import("../store/review.js");
  return useReviewStore;
}

describe("pane layout (#195)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts from the defaults", async () => {
    const store = await loadStore();
    expect(store.getState().panes["review-sidebar"]).toEqual({ size: "280px", collapsed: false });
  });

  it("remembers a resize and a collapse across reloads", async () => {
    const store = await loadStore();
    store.getState().setPane("review-sidebar", { size: "340px" });
    store.getState().setPane("review-sidebar", { collapsed: true });

    const reloaded = await loadStore();
    expect(reloaded.getState().panes["review-sidebar"]).toEqual({ size: "340px", collapsed: true });
  });

  it("gives a pane its default when what was stored can't be read", async () => {
    localStorage.setItem("diffprism-panes", "{not json");
    const store = await loadStore();
    expect(store.getState().panes["review-sidebar"]).toEqual({ size: "280px", collapsed: false });
  });

  it("fills in what a stored layout from an older build is missing", async () => {
    localStorage.setItem("diffprism-panes", JSON.stringify({ "review-sidebar": { collapsed: true } }));
    const store = await loadStore();
    expect(store.getState().panes["review-sidebar"]).toEqual({ size: "280px", collapsed: true });
  });
});

describe("useSavedPane (#195)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function mount(available = true) {
    vi.resetModules();
    const { renderHook } = await import("@testing-library/react");
    const { useSavedPane } = await import("../hooks/useSavedPane.js");
    const { useReviewStore } = await import("../store/review.js");
    const { result } = renderHook(() => useSavedPane("review-threads", 1, available));
    return { pane: result, store: useReviewStore };
  }

  it("saves the size a pane is dragged to", async () => {
    const { pane, store } = await mount();
    pane.current.splitterProps.onResizeEnd(0, [70, 30]);
    expect(store.getState().panes["review-threads"].size).toBe(30);
  });

  it("keeps the last open size when a pane is dragged shut, so showing it brings that back", async () => {
    const { pane, store } = await mount();
    pane.current.splitterProps.onResizeEnd(0, [70, 30]);
    pane.current.splitterProps.onResizeEnd(0, [100, 0]);
    pane.current.splitterProps.onCollapseChange(1, true);

    expect(store.getState().panes["review-threads"]).toEqual({ size: 30, collapsed: true });
  });

  it("ignores another pane's collapse", async () => {
    const { pane, store } = await mount();
    pane.current.splitterProps.onCollapseChange(0, true);
    expect(store.getState().panes["review-threads"].collapsed).toBe(false);
  });

  it("doesn't save hiding a pane that has nothing to show as the viewer's choice", async () => {
    // No threads yet: the splitter collapses the pane, and reports it. When a
    // thread arrives, the pane should open as the viewer last left it.
    const { pane, store } = await mount(false);
    pane.current.splitterProps.onCollapseChange(1, true);
    pane.current.splitterProps.onResizeEnd(0, [100, 0]);

    expect(store.getState().panes["review-threads"]).toEqual({ size: 40, collapsed: false });
  });
});

describe("saving pane layout (#195)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes nothing when a change changes nothing", async () => {
    // The splitter reports expanding a pane the store asked it to expand.
    const store = await loadStore();
    store.getState().setPane("review-threads", { collapsed: false });
    expect(localStorage.getItem("diffprism-panes")).toBeNull();
  });
});
