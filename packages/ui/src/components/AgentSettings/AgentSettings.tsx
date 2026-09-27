import { useEffect, useRef, useState } from "react";
import { Bot, Check } from "lucide-react";
import type { AgentModel, AgentSettings, ReviewAgentName } from "../../types";
import { useHttpApi } from "../../hooks/useHttpApi";

const AGENTS: Array<{ name: ReviewAgentName; label: string }> = [
  { name: "claude", label: "Claude Code" },
  { name: "cursor", label: "Cursor" },
];

const labelOf = (name: ReviewAgentName) => AGENTS.find((a) => a.name === name)?.label ?? name;

/**
 * Which agent answers your comments on a PR review, and with which model
 * (#226). Saved on the server, in the same file `diffprism config` writes, so
 * the two never disagree. `diffprism review --agent/--model` overrides it for
 * one review.
 */
export function AgentSettingsControl() {
  const { isAvailable, getAgentSettings, saveAgentSettings } = useHttpApi();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [draft, setDraft] = useState<AgentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAvailable) return;
    getAgentSettings().then((result) => {
      if (result.ok) {
        setSaved(result.settings);
        setDraft(result.settings);
      } else {
        setError(result.error);
      }
    });
  }, [isAvailable, getAgentSettings]);

  // Close on a click outside, like the file menu.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!isAvailable) return null;

  async function save() {
    if (!draft) return;
    setState("saving");
    setError(null);
    const result = await saveAgentSettings(draft);
    if (result.ok) {
      setSaved(result.settings);
      setDraft(result.settings);
      setState("saved");
    } else {
      setError(result.error);
      setState("idle");
    }
  }

  const model = saved?.models[saved.agent];
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setState("idle");
        }}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        title="Which agent answers your comments on a PR review"
      >
        <Bot className="w-3 h-3" />
        {saved ? `Review agent: ${labelOf(saved.agent)}${model ? ` · ${model}` : ""}` : "Review agent"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Review agent"
          className="absolute bottom-full left-0 mb-2 w-72 bg-surface border border-border rounded-lg shadow-lg p-3 z-50 text-xs"
        >
          <p className="font-semibold text-text-primary mb-1">Review agent</p>
          <p className="text-text-secondary mb-3">
            Answers your comments on a pull request review. Applies to the next review you open.
          </p>

          {error && (
            <p role="alert" className="mb-3 px-2 py-1.5 rounded bg-danger/10 border border-danger/30 text-text-primary">
              {error}
            </p>
          )}

          {draft && (
            <>
              <fieldset className="mb-3">
                <legend className="text-text-secondary mb-1">Agent</legend>
                {AGENTS.map((a) => (
                  <label key={a.name} className="flex items-center gap-2 py-0.5 text-text-primary cursor-pointer">
                    <input
                      type="radio"
                      name="review-agent"
                      checked={draft.agent === a.name}
                      onChange={() => {
                        setDraft({ ...draft, agent: a.name });
                        setState("idle");
                      }}
                      className="accent-accent"
                    />
                    {a.label}
                  </label>
                ))}
              </fieldset>

              <ModelPicker
                agent={draft.agent}
                value={draft.models[draft.agent] ?? ""}
                onChange={(model) => {
                  setDraft({ ...draft, models: { ...draft.models, [draft.agent]: model } });
                  setState("idle");
                }}
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={!changed || state === "saving"}
                  className="px-3 py-1 rounded bg-accent text-white font-medium disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  {state === "saving" ? "Saving…" : "Save"}
                </button>
                {state === "saved" && (
                  <span className="flex items-center gap-1 text-success">
                    <Check className="w-3 h-3" /> Saved
                  </span>
                )}
              </div>

              <p className="text-text-secondary mt-3">
                For one review: <code className="text-accent">diffprism review &lt;PR&gt; --agent cursor --model …</code>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A model's family: its id without the effort level and speed, e.g. gpt-5.3-codex-high-fast → gpt-5.3-codex. */
export function modelFamily(id: string): string {
  return id.replace(/-fast$/, "").replace(/-(none|minimal|low|medium|high|xhigh|max)$/, "");
}

const OTHER = "__other__";
const inputClass =
  "w-full bg-background border border-border rounded px-2 py-1 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent";

/**
 * The models the agent's own CLI lists, to pick from rather than type (#244):
 * its default first, then each family together, then Other… for a model the
 * list doesn't name. When the agent can't list them, a text field, and why.
 */
function ModelPicker({ agent, value, onChange }: { agent: ReviewAgentName; value: string; onChange: (model: string) => void }) {
  const { getAgentModels } = useHttpApi();
  const [models, setModels] = useState<AgentModel[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    setModels(null);
    setProblem(null);
    setTyping(false);
    // Switched to another agent before this list came back: it's the wrong
    // agent's now, so it must not land in this picker, or be saved from it.
    let current = true;
    getAgentModels(agent).then((result) => {
      if (!current) return;
      if (result.ok) setModels(result.models);
      else setProblem(result.error);
    });
    return () => {
      current = false;
    };
  }, [agent, getAgentModels]);

  if (models === null && problem === null) {
    return <p className="mb-3 text-text-secondary">Finding {labelOf(agent)}'s models…</p>;
  }

  const listed = models?.some((m) => m.id === value) ?? false;
  // A model the list doesn't name stays as it was typed, not silently lost.
  const freeText = problem !== null || typing || (value !== "" && !listed);

  const families = new Map<string, AgentModel[]>();
  for (const model of models ?? []) {
    const family = modelFamily(model.id);
    families.set(family, [...(families.get(family) ?? []), model]);
  }

  return (
    <div className="mb-3">
      <label className="block">
        <span className="block text-text-secondary mb-1">Model for {labelOf(agent)}</span>
        {freeText ? (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`${labelOf(agent)}'s default`}
            className={inputClass}
          />
        ) : (
          <select
            value={value}
            onChange={(e) => {
              if (e.target.value === OTHER) setTyping(true);
              else onChange(e.target.value);
            }}
            className={inputClass}
          >
            <option value="">{labelOf(agent)}'s default</option>
            {[...families].map(([family, members]) => (
              <optgroup key={family} label={family}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={OTHER}>Other…</option>
          </select>
        )}
      </label>
      {problem && <p className="mt-1 text-text-secondary">Couldn't list models: {problem}</p>}
      {freeText && models !== null && (
        <button
          type="button"
          onClick={() => {
            setTyping(false);
            if (!listed) onChange("");
          }}
          className="mt-1 text-accent hover:underline"
        >
          Choose from the list
        </button>
      )}
    </div>
  );
}
