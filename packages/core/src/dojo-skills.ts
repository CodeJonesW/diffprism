import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configFilePath } from "./agent-settings.js";

// ─── Skills the review dojo applies (#290) ───
//
// A skill is a folder holding a SKILL.md: a description in its frontmatter,
// and instructions in its body — Claude Code's format. The reviewer picks the
// ones the dojo should review by, and DiffPrism puts each one's instructions
// in every dojo agent's instructions. That works the same for every agent,
// Claude Code or not: none has to know where skills live, or have them
// installed.
//
// Two places hold them: the reviewer's own (~/.claude/skills), and a
// repository's (.claude/skills), which apply only to a local review of that
// same repository. A pull request's are never read: its checkout is the PR
// author's code (#257).

export type SkillScope = "user" | "project";

/** A skill that can be chosen for the dojo. */
export interface SkillInfo {
  /**
   * `user:<folder>`, or `project:<folder>@<repository path>`. A project skill
   * is named with its repository, so choosing one repo's `house-style` never
   * applies another repo's folder of the same name.
   */
  id: string;
  scope: SkillScope;
  /** From its frontmatter, or its folder's name. */
  name: string;
  description?: string;
}

/** A chosen skill, ready to give an agent. */
export interface DojoSkill {
  name: string;
  /** Its instructions: SKILL.md without the frontmatter. */
  instructions: string;
}

const FOLDER = /^[A-Za-z0-9_.-]+$/;

type ParsedId = { scope: "user"; folder: string } | { scope: "project"; folder: string; repo: string };

function parseSkillId(id: unknown): ParsedId | null {
  if (typeof id !== "string") return null;
  const user = id.match(/^user:(.+)$/);
  const project = id.match(/^project:([^@]+)@(.+)$/);
  const folder = user?.[1] ?? project?.[1];
  if (!folder || !FOLDER.test(folder) || folder === "." || folder === "..") return null;
  if (user) return { scope: "user", folder };
  if (project && path.isAbsolute(project[2])) return { scope: "project", folder, repo: path.resolve(project[2]) };
  return null;
}

export function isSkillId(id: unknown): id is string {
  return parseSkillId(id) !== null;
}

const userSkillsDir = () => path.join(os.homedir(), ".claude", "skills");
const projectSkillsDir = (repo: string) => path.join(repo, ".claude", "skills");

/** Folded (`>`) and literal (`|`) YAML block values, as descriptions often are, and quoted ones. */
function frontmatterField(lines: string[], key: string): string | undefined {
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at === -1) return undefined;
  const value = lines[at].slice(key.length + 1).trim();
  if (/^[>|][-+]?$/.test(value)) {
    const block: string[] = [];
    for (const line of lines.slice(at + 1)) {
      if (line.trim() !== "" && !/^\s/.test(line)) break;
      block.push(line.trim());
    }
    const text = value.startsWith(">") ? block.join(" ").replace(/\s+/g, " ") : block.join("\n");
    return text.trim() || undefined;
  }
  // Quotes only when they match, at both ends.
  const quoted = value.match(/^(["'])(.*)\1$/);
  return (quoted ? quoted[2] : value) || undefined;
}

/** The frontmatter's `name` and `description`, and the body after it. */
export function parseSkill(text: string): { name?: string; description?: string; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: text.trim() };
  const lines = match[1].split(/\r?\n/);
  return { name: frontmatterField(lines, "name"), description: frontmatterField(lines, "description"), body: match[2].trim() };
}

/** Folders holding a SKILL.md — a folder linked from elsewhere (a dotfiles repo, a plugin) counts too. */
function skillFolders(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((folder) => FOLDER.test(folder) && fs.existsSync(path.join(dir, folder, "SKILL.md")) && fs.statSync(path.join(dir, folder)).isDirectory());
}

function skillInfo(file: string, folder: string, scope: SkillScope, id: string): SkillInfo {
  const { name, description } = parseSkill(fs.readFileSync(file, "utf-8"));
  return { id, scope, name: name ?? folder, description };
}

/**
 * The skills there are to choose from: the reviewer's own, and — for a local
 * review — its repository's.
 */
export function listSkills(projectRoot?: string): SkillInfo[] {
  const byName = (a: SkillInfo, b: SkillInfo) => a.name.localeCompare(b.name);
  const user = skillFolders(userSkillsDir())
    .map((folder) => skillInfo(path.join(userSkillsDir(), folder, "SKILL.md"), folder, "user", `user:${folder}`))
    .sort(byName);
  if (!projectRoot) return user;
  const repo = path.resolve(projectRoot);
  const project = skillFolders(projectSkillsDir(repo))
    .map((folder) => skillInfo(path.join(projectSkillsDir(repo), folder, "SKILL.md"), folder, "project", `project:${folder}@${repo}`))
    .sort(byName);
  return [...user, ...project];
}

/** The skills chosen for the dojo, as saved. None saved is none chosen. */
export function readDojoSkillIds(): string[] {
  const file = configFilePath();
  if (!fs.existsSync(file)) return [];
  const config = JSON.parse(fs.readFileSync(file, "utf-8")) as { dojo?: { skills?: unknown } };
  const skills = config.dojo?.skills ?? [];
  if (!Array.isArray(skills) || !skills.every(isSkillId)) {
    throw new Error(`${file}: dojo.skills must be a list of skill ids like "user:<folder>" or "project:<folder>@<repository path>".`);
  }
  return skills;
}

/** Save the dojo's skills, keeping everything else in the file as it was. */
export function writeDojoSkillIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || !ids.every(isSkillId)) {
    throw new Error('skills must be a list of skill ids like "user:<folder>" or "project:<folder>@<repository path>".');
  }
  const file = configFilePath();
  const config = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>) : {};
  const unique = [...new Set(ids)];
  config.dojo = { ...((config.dojo as object | undefined) ?? {}), skills: unique };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  return unique;
}

/**
 * The chosen skills' instructions, for a dojo on this review. A skill of the
 * reviewer's own that's gone is an error that says so: they chose it, and a
 * dojo quietly reviewing without it would mislead them. A project's skill
 * applies only to a local review of the repository it was chosen in, and
 * never to a pull request (`projectRoot` absent), whose checkout is the
 * author's code.
 */
export function resolveDojoSkills(ids: string[], projectRoot?: string): DojoSkill[] {
  const repo = projectRoot ? path.resolve(projectRoot) : undefined;
  const skills: DojoSkill[] = [];
  for (const id of ids) {
    const parsed = parseSkillId(id);
    if (!parsed) throw new Error(`Not a dojo skill id: ${JSON.stringify(id)}`);
    if (parsed.scope === "project" && parsed.repo !== repo) continue;
    const dir = parsed.scope === "user" ? userSkillsDir() : projectSkillsDir(parsed.repo);
    const file = path.join(dir, parsed.folder, "SKILL.md");
    if (!fs.existsSync(file)) {
      throw new Error(`The dojo skill "${parsed.folder}" is chosen in Settings, but ${file} isn't there. Choose again in Settings.`);
    }
    const { name, body } = parseSkill(fs.readFileSync(file, "utf-8"));
    skills.push({ name: name ?? parsed.folder, instructions: body });
  }
  return skills;
}
