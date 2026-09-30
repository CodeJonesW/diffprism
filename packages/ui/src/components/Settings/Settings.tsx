import { useEffect, useState } from "react";
import { Settings as SettingsIcon, X } from "lucide-react";
import type { AgentSettings } from "../../types";
import { useHttpApi } from "../../hooks/useHttpApi";
import { AgentSettingsForm, agentSummary } from "../AgentSettings";
import { DojoSkillsForm } from "./DojoSkillsForm";

/**
 * Settings, from the sessions sidebar (#290): the review agent (#226) and the
 * dojo's skills, in a modal. A modal has room a sidebar popover didn't — the
 * review agent's panel was cut off in a narrow sidebar (#259). The button
 * says which agent is chosen, so it's known without opening it.
 */
export function SettingsControl() {
  const { isAvailable, getAgentSettings } = useHttpApi();
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<AgentSettings | null>(null);

  useEffect(() => {
    if (!isAvailable) return;
    getAgentSettings().then((result) => {
      if (result.ok) setAgent(result.settings);
    });
  }, [isAvailable, getAgentSettings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!isAvailable) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer text-left"
        title="The review agent, and the dojo's skills"
      >
        <SettingsIcon className="w-3 h-3 flex-shrink-0" />
        <span className="truncate">Settings{agent ? ` · ${agentSummary(agent)}` : ""}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => {
            // A click on the backdrop, not inside the dialog, closes it.
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-surface border border-border rounded-lg shadow-lg"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-border/50"
                aria-label="Close settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-6">
              <AgentSettingsForm onSaved={setAgent} />
              <DojoSkillsForm />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
