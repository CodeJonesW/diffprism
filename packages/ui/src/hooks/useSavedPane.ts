import { useLayoutEffect, useRef } from "react";
import type { SplitterPaneSize, UseSplitterReturnValue } from "@mantine/hooks";
import { useReviewStore, type PaneId } from "../store/review";

/** A size of zero is a collapsed pane, not a size to come back to. */
function isOpenSize(size: SplitterPaneSize): boolean {
  return parseFloat(String(size)) > 0;
}

/**
 * Wires one collapsible pane of a Mantine Splitter to its saved layout.
 *
 * The store owns the layout: a drag or a collapse reports there, and a toggle
 * anywhere can change it, so this makes the splitter match. It does that
 * before paint — Splitter.Pane has no collapsed-by-default prop, so a pane
 * saved as hidden would otherwise flash open on load.
 *
 * `available: false` hides the pane without touching what's saved: the threads
 * pane has nothing to show until a review has threads, but the viewer's choice
 * to keep it open or shut should still stand once one arrives.
 */
export function useSavedPane(id: PaneId, paneIndex: number, available = true) {
  const pane = useReviewStore((s) => s.panes[id]);
  const setPane = useReviewStore((s) => s.setPane);
  const splitterRef = useRef<UseSplitterReturnValue>(null);
  const hidden = pane.collapsed || !available;

  useLayoutEffect(() => {
    const splitter = splitterRef.current;
    if (!splitter || splitter.collapsed[paneIndex] === hidden) return;
    if (hidden) splitter.collapse(paneIndex);
    else splitter.expand(paneIndex);
  }, [hidden, paneIndex]);

  return {
    /** The saved size, for the pane's defaultSize. */
    defaultSize: pane.size,
    collapsed: pane.collapsed,
    setCollapsed: (collapsed: boolean) => setPane(id, { collapsed }),
    /** Spread onto the <Splitter>. */
    splitterProps: {
      splitterRef,
      onResizeEnd: (_handle: number, sizes: SplitterPaneSize[]) => {
        const size = sizes[paneIndex];
        // Dragged shut, the size is 0: keep the last open size to restore to.
        if (available && isOpenSize(size)) setPane(id, { size });
      },
      onCollapseChange: (index: number, collapsed: boolean) => {
        // Collapsing because there's nothing to show isn't the viewer's choice.
        if (index === paneIndex && available) setPane(id, { collapsed });
      },
    },
  };
}
