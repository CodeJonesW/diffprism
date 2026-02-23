import { useEffect } from "react";
import { useReviewStore } from "../../store/review";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const modKey = isMac ? "\u2318" : "Ctrl";

const shortcuts = [
  { keys: ["j", "\u2193"], action: "Next file" },
  { keys: ["k", "\u2191"], action: "Previous file" },
  { keys: ["s"], action: "Cycle file status" },
  { keys: [`${modKey} + Enter`], action: "Save comment" },
  { keys: ["Esc"], action: "Cancel comment / Close guide" },
  { keys: ["?"], action: "Toggle this guide" },
];

export function HotkeyGuide() {
  const { showHotkeyGuide, toggleHotkeyGuide } = useReviewStore();

  useEffect(() => {
    if (!showHotkeyGuide) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        toggleHotkeyGuide();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [showHotkeyGuide, toggleHotkeyGuide]);

  if (!showHotkeyGuide) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={toggleHotkeyGuide}
    >
      <div
        className="bg-surface border border-border rounded-lg shadow-xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-text-primary text-sm font-semibold mb-4">
          Keyboard Shortcuts
        </h2>
        <div className="space-y-2">
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.action}
              className="flex items-center justify-between gap-4"
            >
              <span className="text-text-secondary text-sm">
                {shortcut.action}
              </span>
              <div className="flex items-center gap-1.5">
                {shortcut.keys.map((key, i) => (
                  <span key={key} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <span className="text-text-secondary/50 text-xs">/</span>
                    )}
                    <kbd className="px-1.5 py-0.5 text-xs font-mono rounded border border-border bg-background text-text-primary">
                      {key}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
