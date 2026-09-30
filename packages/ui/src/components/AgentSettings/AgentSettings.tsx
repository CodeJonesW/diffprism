import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { AgentModel, AgentSettings, ReviewAgentName } from "../../types";
import { useHttpApi } from "../../hooks/useHttpApi";

const AGENTS: Array<{ name: ReviewAgentName; label: string }> = [
  { name: "claude", label: "Claude Code" },
  { name: "cursor", label: "Cursor" },
];

const labelOf = (name: ReviewAgentName) => AGENTS.find((a) => a.name === name)?.label ?? name;

/** The saved choice in a line: "Review agent: Cursor · gpt-5.3-codex". */
export function agentSummary(settings: AgentSettings): string {
  const model = settings.models[settings.agent];
  return `Review agent: ${labelOf(settings.agent)}${model ? ` · ${model}` : ""}`;
}

/**
 * Which agent answers your comments on a PR review, and with which model
 * (#226). Saved on the server, in the same file `diffprism config` writes, so
 * the two never disagree. `diffprism review --agent/--model` overrides it for
 * one review. It's a section of the Settings modal (#290).
 */
export function AgentSettingsForm({ onSaved }: { onSaved?: (settings: AgentSettings) => void }) {
  const { getAgentSettings, saveAgentSettings } = useHttpApi();
  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [draft, setDraft] = useState<AgentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    getAgentSettings().then((result) => {
      if (result.ok) {
        setSaved(result.settings);
        setDraft(result.settings);
      } else {
        setError(result.error);
      }
    });
  }, [getAgentSettings]);

  async function save() {
    if (!draft) return;
    setState("saving");
    setError(null);
    const result = await saveAgentSettings(draft);
    if (result.ok) {
      setSaved(result.settings);
      setDraft(result.settings);
      setState("saved");
      onSaved?.(result.settings);
    } else {
      setError(result.error);
      setState("idle");
    }
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <section aria-label="Review agent" className="text-xs">
          <h3 className="font-semibold text-text-primary mb-1">Review agent</h3>
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
    </section>
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
