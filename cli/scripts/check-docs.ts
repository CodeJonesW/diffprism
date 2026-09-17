/**
 * Fails when the docs describe a DiffPrism that the code no longer is.
 *
 * The code is the source of truth, read by introspection rather than by
 * pattern-matching source: tools come from listing a real MCP server, CLI
 * commands from the real Commander program, WebSocket messages from the
 * ServerMessage / ClientMessage unions. Docs are only checked where they make
 * a structural claim — a tool heading or table row, a parameter list, a
 * `diffprism …` invocation in code, a repo path, a tool count, the protocol
 * lines — so prose can still mention history ("replaces `add_annotation`").
 *
 * Run: pnpm docs:check
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Help, type Command } from "commander";
import ts from "typescript";
import { createMcpServer } from "@diffprism/mcp-server";
import { createProgram } from "../src/program.js";
import { skillContent } from "../src/templates/skill.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Dated plans and retired docs record what was true then; they are not checked. */
const HISTORICAL = [
  "docs/deprecated/",
  "docs/marketing/",
  "docs/product-plan-discussion-2026-02-27.md",
  "docs/server-first-plan.md",
];

/** The docs whose CLI Reference must list every visible command. */
const CLI_REFERENCE = { file: "README.md", heading: "## CLI Reference" };

interface Doc {
  file: string;
  lines: string[];
}

interface Problem {
  file: string;
  line: number;
  message: string;
}

// ─── Source of truth ───

async function listTools(): Promise<Map<string, Set<string>>> {
  const server = createMcpServer();
  const client = new Client({ name: "docs-check", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return new Map(tools.map((t) => [t.name, new Set(Object.keys(t.inputSchema.properties ?? {}))]));
}

function messageTypes(unionName: string): Set<string> {
  const file = path.join(ROOT, "packages/core/src/types.ts");
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const alias = source.statements.find(
    (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === unionName,
  );
  if (!alias || !ts.isUnionTypeNode(alias.type)) {
    throw new Error(`${unionName} is no longer a union in packages/core/src/types.ts — update check-docs.ts`);
  }
  const types = new Set<string>();
  for (const member of alias.type.types) {
    if (!ts.isTypeLiteralNode(member)) continue;
    for (const prop of member.members) {
      if (
        ts.isPropertySignature(prop) &&
        prop.name.getText(source) === "type" &&
        prop.type &&
        ts.isLiteralTypeNode(prop.type) &&
        ts.isStringLiteral(prop.type.literal)
      ) {
        types.add(prop.type.literal.text);
      }
    }
  }
  return types;
}

function checkedDocs(): Doc[] {
  const tracked = execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !HISTORICAL.some((h) => f.startsWith(h)));
  const docs = tracked.map((file) => ({ file, lines: fs.readFileSync(path.join(ROOT, file), "utf8").split("\n") }));
  // The skill installed by `diffprism setup` — its content starts on line 1 of the template file.
  docs.push({ file: "cli/src/templates/skill.ts", lines: skillContent.split("\n") });
  return docs;
}

// ─── Markdown structure ───

/** Code on each line: whole lines inside code fences, inline `spans` elsewhere (including markdown fences). */
function codeByLine(doc: Doc): { line: number; code: string }[] {
  const out: { line: number; code: string }[] = [];
  let fence: string | null = null;
  doc.lines.forEach((text, i) => {
    const marker = text.match(/^\s*```(\w*)/);
    if (marker) {
      fence = fence === null ? marker[1] : null;
      return;
    }
    if (fence !== null && fence !== "markdown" && fence !== "md") out.push({ line: i + 1, code: text });
    else for (const m of text.matchAll(/`([^`]+)`/g)) out.push({ line: i + 1, code: m[1] });
  });
  return out;
}

function tableCells(text: string): string[] | null {
  if (!/^\s*\|/.test(text)) return null;
  return text.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

/** Backticked names at the top level of a comma list, ignoring anything in parentheses. */
function topLevelNames(text: string): string[] {
  let flat = text;
  while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\([^()]*\)/g, "");
  return [...flat.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
}

// ─── Checks ───

function checkTools(doc: Doc, tools: Map<string, Set<string>>, problems: Problem[]): void {
  const report = (line: number, message: string) => problems.push({ file: doc.file, line, message });
  const listed = new Set<string>();
  let currentTool: string | null = null;
  let currentToolLevel = 0;
  let tableHeader: string | null = null;

  doc.lines.forEach((text, i) => {
    const line = i + 1;

    for (const m of text.matchAll(/(?<![\w/.-])(\d+) (?:DiffPrism )?(?:MCP )?tools\b/g)) {
      if (Number(m[1]) !== tools.size) report(line, `says ${m[1]} tools; the MCP server registers ${tools.size}`);
    }
    for (const m of text.matchAll(/mcp__diffprism__([a-z][a-z_]*)/g)) {
      if (!tools.has(m[1])) report(line, `\`mcp__diffprism__${m[1]}\` is not a registered tool`);
    }

    const heading = text.match(/^(#{1,6})\s/);
    if (heading) {
      const level = heading[1].length;
      const toolHeading = text.match(/^#{1,6}\s+`([a-z][a-z_]*)`\s*$/);
      if (toolHeading) {
        const name = toolHeading[1];
        if (!tools.has(name)) report(line, `heading documents \`${name}\`, which is not a registered tool`);
        listed.add(name);
        currentTool = name;
        currentToolLevel = level;
      } else if (level <= currentToolLevel) {
        currentTool = null;
      }
      tableHeader = null;
      return;
    }

    const cells = tableCells(text);
    if (!cells) {
      tableHeader = null;
      const params = text.match(/^\s*-\s*\*\*Params:\*\*(.*)$/);
      if (params && currentTool && tools.has(currentTool)) {
        for (const name of topLevelNames(params[1])) {
          if (!tools.get(currentTool)!.has(name)) {
            report(line, `\`${currentTool}\` has no parameter \`${name}\``);
          }
        }
      }
      return;
    }
    if (tableHeader === null) {
      tableHeader = cells[0];
      return;
    }
    const name = cells[0].match(/^`([a-z][a-z0-9_]*)`$/)?.[1];
    if (!name) return;
    if (tableHeader === "Tool") {
      if (!tools.has(name)) report(line, `table lists \`${name}\`, which is not a registered tool`);
      listed.add(name);
    } else if (tableHeader === "Parameter" && currentTool && tools.has(currentTool)) {
      if (!tools.get(currentTool)!.has(name)) report(line, `\`${currentTool}\` has no parameter \`${name}\``);
    }
  });

  // A doc that is a tool reference is a complete one.
  if (listed.size > 0) {
    for (const name of tools.keys()) {
      if (!listed.has(name)) report(1, `documents MCP tools but leaves out \`${name}\``);
    }
  }
}

interface ResolvedInvocation {
  commandPath: string;
  problem: string | null;
}

const INVOCATION = /(?<![\w/.@-])(?:npx\s+)?(?:diffprism(?:@[\w.-]+)?|pnpm cli|tsx cli\/src\/index\.ts)\s+([^#|;&`)]*)/g;

function resolveInvocation(program: Command, argText: string): ResolvedInvocation {
  const tokens = argText.replace(/"[^"]*"|'[^']*'|<[^>]*>|…/g, " ").trim().split(/\s+/).filter(Boolean);
  let command = program;
  const names: string[] = [];
  let sawArgument = false;
  for (const token of tokens) {
    if (token === "--") continue;
    if (token.startsWith("-")) {
      const flag = token.split("=")[0];
      const known =
        ["-h", "--help"].includes(flag) ||
        command.options.some((o) => o.long === flag || o.short === flag);
      if (!known) {
        return { commandPath: names.join(" "), problem: `\`diffprism ${names.join(" ")}\` has no option \`${flag}\`` };
      }
      continue;
    }
    const sub = sawArgument ? undefined : command.commands.find((c) => c.name() === token || c.aliases().includes(token));
    if (sub) {
      command = sub;
      names.push(token);
      continue;
    }
    if (command === program && !/^[a-z]+:\/\/|\//.test(token)) {
      return { commandPath: "", problem: `\`diffprism ${token}\` is not a command` };
    }
    sawArgument = true;
  }
  return { commandPath: names.join(" "), problem: null };
}

function checkCli(doc: Doc, program: Command, problems: Problem[]): Set<string> {
  const invoked = new Set<string>();
  for (const { line, code } of codeByLine(doc)) {
    for (const m of code.matchAll(INVOCATION)) {
      const { commandPath, problem } = resolveInvocation(program, m[1]);
      if (problem) problems.push({ file: doc.file, line, message: problem });
      else invoked.add(`${line}\t${commandPath}`);
    }
  }
  return invoked;
}

function visibleCommandPaths(command: Command, prefix: string[] = []): string[] {
  const help = new Help();
  return help
    .visibleCommands(command)
    .filter((c) => c.name() !== "help")
    .flatMap((c) => {
      const p = [...prefix, c.name()];
      return [p.join(" "), ...visibleCommandPaths(c, p)];
    });
}

function checkCliReference(doc: Doc, invoked: Set<string>, program: Command, problems: Problem[]): void {
  const start = doc.lines.indexOf(CLI_REFERENCE.heading);
  if (start === -1) {
    problems.push({ file: doc.file, line: 1, message: `missing "${CLI_REFERENCE.heading}" section` });
    return;
  }
  const next = doc.lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const end = next === -1 ? doc.lines.length : next;
  const covered = new Set(
    [...invoked]
      .map((entry) => entry.split("\t"))
      .filter(([line]) => Number(line) > start && Number(line) <= end)
      .map(([, commandPath]) => commandPath),
  );
  for (const commandPath of visibleCommandPaths(program)) {
    // `diffprism hook install` also shows that `hook` exists.
    if (![...covered].some((c) => c === commandPath || c.startsWith(`${commandPath} `))) {
      problems.push({ file: doc.file, line: start + 1, message: `CLI Reference leaves out \`diffprism ${commandPath}\`` });
    }
  }
}

function checkPaths(doc: Doc, problems: Problem[]): void {
  const docDir = path.dirname(path.join(ROOT, doc.file));
  doc.lines.forEach((text, i) => {
    for (const m of text.matchAll(/`([\w.-]+(?:\/[\w.\[\]-]+)+\/?)`|\*\*([\w.-]+(?:\/[\w.\[\]-]+)+\/?)\*\*/g)) {
      const candidate = m[1] ?? m[2];
      const bases = [ROOT, docDir].filter((base) => fs.existsSync(path.join(base, candidate.split("/")[0])));
      // Only paths rooted in the repo or the doc's own package make a claim; `ComponentName/…` does not.
      if (bases.length === 0) continue;
      if (!bases.some((base) => fs.existsSync(path.join(base, candidate)))) {
        problems.push({ file: doc.file, line: i + 1, message: `\`${candidate}\` does not exist` });
      }
    }
  });
}

function checkProtocol(doc: Doc, server: Set<string>, client: Set<string>, problems: Problem[]): void {
  doc.lines.forEach((text, i) => {
    const m = text.match(/(Server → Client|Client → Server):(.*)$/);
    if (!m) return;
    const [union, actual] = m[1] === "Server → Client" ? ["ServerMessage", server] : ["ClientMessage", client];
    const documented = new Set([...m[2].matchAll(/`([a-z]+:[a-z_]+)`/g)].map((x) => x[1]));
    for (const t of documented) {
      if (!actual.has(t)) problems.push({ file: doc.file, line: i + 1, message: `\`${t}\` is not in ${union}` });
    }
    for (const t of actual) {
      if (!documented.has(t)) problems.push({ file: doc.file, line: i + 1, message: `${union} \`${t}\` is not listed` });
    }
  });
}

// ─── Main ───

const tools = await listTools();
const program = createProgram();
const serverMessages = messageTypes("ServerMessage");
const clientMessages = messageTypes("ClientMessage");
const problems: Problem[] = [];

for (const doc of checkedDocs()) {
  checkTools(doc, tools, problems);
  const invoked = checkCli(doc, program, problems);
  if (doc.file === CLI_REFERENCE.file) checkCliReference(doc, invoked, program, problems);
  checkPaths(doc, problems);
  checkProtocol(doc, serverMessages, clientMessages, problems);
}

for (const p of problems) {
  console.log(`${p.file}:${p.line}: ${p.message}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error file=${p.file},line=${p.line}::${p.message}`);
}
if (problems.length > 0) {
  console.log(`\n${problems.length} doc drift problem(s). Fix the docs (or the code) so they agree.`);
  process.exit(1);
}
console.log(`Docs in sync: ${tools.size} tools, ${visibleCommandPaths(program).length} commands, ${serverMessages.size + clientMessages.size} messages.`);
