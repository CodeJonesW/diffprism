import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { SkillInfo } from "../../types";
import { useHttpApi } from "../../hooks/useHttpApi";
import { useReviewStore } from "../../store/review";

/**
 * The skills the review dojo reviews by (#290). A skill is a folder with a
 * SKILL.md, Claude Code's format; the dojo puts each chosen one's
 * instructions in every agent's, so Cursor reviews by them too. Your own are
 * in ~/.claude/skills; a repository's .claude/skills apply to local reviews
 * of it, and never to a pull request.
 */
export function DojoSkillsForm() {
  const { getDojoSettings, saveDojoSkills } = useHttpApi();
  // A local review open now shows its repository's skills too.
  const reviewId = useReviewStore((s) => s.reviewId);
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    // A reply for a review that's no longer open would show the wrong repository's skills.
    let current = true;
    getDojoSettings(reviewId).then((result) => {
      if (!current) return;
      if (result.ok) {
        setSkills(result.skills);
        setSaved(result.chosen);
        setChosen(new Set(result.chosen));
      } else {
        setError(result.error);
      }
    });
    return () => {
      current = false;
    };
  }, [getDojoSettings, reviewId]);

  async function save() {
    setState("saving");
    setError(null);
    const result = await saveDojoSkills([...chosen]);
    if (result.ok) {
      setSaved(result.chosen);
      setChosen(new Set(result.chosen));
      setState("saved");
    } else {
      setError(result.error);
      setState("idle");
    }
  }

  const changed = [...chosen].sort().join() !== [...saved].sort().join();
  // A project's skill is named with its repository (`project:<folder>@<path>`),
  // and applies only there: one chosen in another repository is kept for it.
  const listed = (id: string) => skills?.some((s) => s.id === id) ?? true;
  const folderOf = (id: string) => id.replace(/^\w+:/, "").replace(/@.*$/, "");
  // Yours, chosen but gone: said so, rather than dropped silently.
  const missing = saved.filter((id) => id.startsWith("user:") && !listed(id));
  const elsewhere = saved.filter((id) => id.startsWith("project:") && !listed(id));
  const groups: Array<{ scope: SkillInfo["scope"]; title: string }> = [
    { scope: "user", title: "Yours (~/.claude/skills)" },
    { scope: "project", title: "This repository's (.claude/skills), for local reviews of it" },
  ];

  return (
    <section aria-label="Dojo skills" className="text-xs">
      <h3 className="font-semibold text-text-primary mb-1">Dojo skills</h3>
      <p className="text-text-secondary mb-3">
        Every agent in the review dojo reviews by the skills you choose, Claude Code or not. Applies to the next dojo you
        start.
      </p>

      {error && (
        <p role="alert" className="mb-3 px-2 py-1.5 rounded bg-danger/10 border border-danger/30 text-text-primary">
          {error}
        </p>
      )}

      {skills === null && !error && <p className="text-text-secondary">Finding skills…</p>}

      {skills !== null && skills.length === 0 && (
        <p className="text-text-secondary mb-3">
          No skills found. A skill is a folder holding a <code className="text-accent">SKILL.md</code>, in{" "}
          <code className="text-accent">~/.claude/skills</code> or a repository's{" "}
          <code className="text-accent">.claude/skills</code>.
        </p>
      )}

      {skills !== null &&
        groups.map(({ scope, title }) => {
          const inGroup = skills.filter((s) => s.scope === scope);
          if (inGroup.length === 0) return null;
          return (
            <fieldset key={scope} className="mb-3">
              <legend className="text-text-secondary mb-1">{title}</legend>
              {inGroup.map((skill) => (
                <label key={skill.id} className="flex items-start gap-2 py-0.5 text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-accent"
                    checked={chosen.has(skill.id)}
                    onChange={() => {
                      setChosen((current) => {
                        const next = new Set(current);
                        if (next.has(skill.id)) next.delete(skill.id);
                        else next.add(skill.id);
                        return next;
                      });
                      setState("idle");
                    }}
                  />
                  <span>
                    {skill.name}
                    {skill.description && <span className="block text-text-secondary">{skill.description}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}

      {missing.length > 0 && (
        <p className="mb-3 text-warning">
          Chosen but not found: {missing.map(folderOf).join(", ")}. The dojo won't start until you choose again.
        </p>
      )}
      {elsewhere.length > 0 && (
        <p className="mb-3 text-text-secondary">
          Also chosen for other repositories, and used only in their local reviews: {elsewhere.map(folderOf).join(", ")}.
        </p>
      )}

      {skills !== null && (skills.length > 0 || saved.length > 0) && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!changed || state === "saving"}
            className="px-3 py-1 rounded bg-accent text-white font-medium disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            {state === "saving" ? "Saving…" : "Save skills"}
          </button>
          {state === "saved" && (
            <span className="flex items-center gap-1 text-success">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
        </div>
      )}
    </section>
  );
}
