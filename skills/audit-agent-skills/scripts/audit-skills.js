#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const AXES = ["structure", "triggers", "safety", "portability", "claude", "codex"];
const CHECKER_VERSION = "0.3.0";
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 320, maxFileBytes: 1024 * 1024, maxTotalBytes: 6 * 1024 * 1024 });
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".pdf", ".zip", ".gz", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".mov"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "vendor", "__pycache__"]);

function expandHome(value) {
  const s = String(value || "");
  return s === "~" ? os.homedir() : s.startsWith("~/") ? path.join(os.homedir(), s.slice(2)) : path.resolve(s);
}

function displayPath(value) {
  const p = String(value || "");
  return p === os.homedir() ? "~" : p.startsWith(os.homedir() + path.sep) ? "~" + p.slice(os.homedir().length) : p;
}

function defaultRoots() {
  return [
    { id: "claude", label: "Claude", path: path.join(os.homedir(), ".claude", "skills") },
    { id: "codex", label: "Codex", path: path.join(os.homedir(), ".codex", "skills") },
    { id: "agents", label: "Agent Skills", path: path.join(os.homedir(), ".agents", "skills") },
  ];
}

function normalizeRoots(roots) {
  return (roots && roots.length ? roots : defaultRoots()).map((root, index) => {
    if (typeof root === "string") return { id: `root-${index + 1}`, label: `Root ${index + 1}`, path: expandHome(root) };
    return {
      id: String(root.id || `root-${index + 1}`),
      label: String(root.label || root.id || `Root ${index + 1}`),
      path: expandHome(root.path),
    };
  });
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}

function lineOf(text, needle) {
  const at = String(text || "").indexOf(String(needle || ""));
  return at < 0 ? 1 : String(text).slice(0, at).split("\n").length;
}

function scalar(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1).trim();
  return s;
}

function parseFrontmatter(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return { ok: false, error: "SKILL.md must begin with YAML frontmatter", fm: {}, body: text, front: "" };
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return { ok: false, error: "YAML frontmatter is not closed with ---", fm: {}, body: text, front: "" };
  const fm = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const source = lines[i];
    if (!source.trim() || /^\s*#/.test(source)) continue;
    const m = source.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const folded = value[0] === ">";
      const block = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || /^\s+/.test(lines[i + 1]))) {
        i++;
        block.push(lines[i].replace(/^\s+/, ""));
      }
      value = folded ? block.join(" ").replace(/\s+/g, " ").trim() : block.join("\n").trim();
    }
    fm[m[1]] = scalar(value);
  }
  return { ok: true, fm, body: match[2], front: match[1] };
}

function isBinary(buffer, file) {
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function collectFiles(skillDir, rootReal, limits) {
  const files = [];
  const notices = [];
  let totalBytes = 0;
  let limited = false;

  function walk(dir) {
    if (limited) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (error) { notices.push({ code: "unreadable-directory", message: `Could not read ${displayPath(dir)}: ${error.message}` }); return; }
    for (const entry of entries) {
      if (files.length >= limits.maxFiles || totalBytes >= limits.maxTotalBytes) { limited = true; break; }
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      let stat;
      try { stat = fs.lstatSync(absolute); } catch { continue; }
      if (stat.isSymbolicLink()) {
        let real = "";
        let resolutionCode = "";
        try { real = fs.realpathSync(absolute); }
        catch (error) { resolutionCode = error && error.code ? error.code : "unresolved"; }
        notices.push({
          code: resolutionCode ? "symlink-unresolved" : "symlink-skipped",
          message: resolutionCode
            ? `Skipped unresolved symlink (${resolutionCode}): ${displayPath(absolute)}`
            : real && !inside(rootReal, real) ? `Refused symlink escaping its root: ${displayPath(absolute)}` : `Skipped symlink: ${displayPath(absolute)}`,
          file: path.relative(skillDir, absolute),
        });
        continue;
      }
      if (stat.isDirectory()) { walk(absolute); continue; }
      if (!stat.isFile()) continue;
      const rel = path.relative(skillDir, absolute).split(path.sep).join("/");
      if (stat.size > limits.maxFileBytes) {
        notices.push({ code: "oversized-file", message: `Skipped ${rel}; it exceeds ${limits.maxFileBytes} bytes`, file: rel });
        files.push({ rel, size: stat.size, binary: true, skipped: true, hash: `oversized:${stat.size}` });
        continue;
      }
      if (totalBytes + stat.size > limits.maxTotalBytes) { limited = true; break; }
      let buffer;
      try { buffer = fs.readFileSync(absolute); } catch { notices.push({ code: "unreadable-file", message: `Could not read ${rel}`, file: rel }); continue; }
      totalBytes += buffer.length;
      const binary = isBinary(buffer, rel);
      files.push({ rel, size: buffer.length, binary, skipped: false, hash: crypto.createHash("sha256").update(buffer).digest("hex"), text: binary ? "" : buffer.toString("utf8") });
    }
  }

  walk(skillDir);
  if (limited) notices.push({ code: "scan-limit", message: `Stopped at the bounded scan limit (${limits.maxFiles} files / ${limits.maxTotalBytes} bytes)` });
  return { files, notices, totalBytes };
}

function digestFiles(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files.slice().sort((a, b) => a.rel.localeCompare(b.rel))) hash.update(file.rel).update("\0").update(file.hash).update("\0");
  return hash.digest("hex");
}

// A refused root symlink has no readable content to hash, but it still needs a
// stable identity: this file dedupes by digest, and every consumer of a finding
// (the Skill Clinic's evidence contract) requires a 64-hex digest before it will
// carry the finding forward. Derive one deterministically from the refusal itself
// — the code, the skill name, the declared root, the link, and what the link
// resolved to — so the same refusal always mints the same digest and one card per
// refused link, exactly as the empty-digest path grouped them. Never a content
// hash: nothing inside the escaping target was read, and nothing should be.
function refusedSymlinkDigest(parts) {
  return crypto.createHash("sha256").update(["skill-symlink-refusal", ...parts].join("\0")).digest("hex");
}

function finding(axis, severity, code, message, file, line, suggestion) {
  return { axis, severity, code, message, file: file || "SKILL.md", line: line || 1, suggestion: suggestion || "Review this evidence before changing the skill." };
}

function textTokens(value) {
  const stop = new Set(["this", "that", "with", "from", "when", "where", "what", "your", "user", "users", "skill", "skills", "agent", "agents", "into", "using", "asks", "asked", "use"]);
  return new Set(String(value || "").toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.filter((x) => !stop.has(x)) || []);
}

function overlapScore(a, b) {
  const aa = textTokens(a), bb = textTokens(b);
  if (aa.size < 3 || bb.size < 3) return 0;
  let both = 0;
  for (const token of aa) if (bb.has(token)) both++;
  return both / Math.min(aa.size, bb.size);
}

function auditCandidate(candidate, limits) {
  const { root, rootReal, dir, dirReal, folder } = candidate;
  const collected = collectFiles(dirReal, rootReal, limits);
  const skillFile = collected.files.find((f) => f.rel === "SKILL.md" && !f.binary && !f.skipped);
  const findings = [];
  for (const note of collected.notices) findings.push(finding(note.code.startsWith("symlink-") ? "safety" : "structure", "review", note.code, note.message, note.file || "SKILL.md", 1));

  let parsed = { ok: false, fm: {}, body: "", front: "", error: "SKILL.md is missing or unreadable" };
  if (skillFile) parsed = parseFrontmatter(skillFile.text);
  if (!skillFile) findings.push(finding("structure", "error", "missing-skill-md", "The skill directory has no readable SKILL.md", "SKILL.md", 1, "Add a SKILL.md with valid YAML frontmatter."));
  else if (!parsed.ok) findings.push(finding("structure", "error", "malformed-frontmatter", parsed.error, "SKILL.md", 1, "Repair the opening YAML frontmatter and its closing delimiter."));

  const fm = parsed.fm || {};
  const name = scalar(fm.name) || folder;
  const description = scalar(fm.description);
  const raw = skillFile ? skillFile.text : "";
  if (parsed.ok) {
    if (!scalar(fm.name)) findings.push(finding("structure", "error", "missing-name", "Frontmatter is missing name", "SKILL.md", 2, "Add a name matching the skill folder."));
    if (!description) findings.push(finding("structure", "error", "missing-description", "Frontmatter is missing description", "SKILL.md", 2, "Describe what the skill does and when it should trigger."));
    if (name.length > 64) findings.push(finding("structure", "error", "name-too-long", "Skill name exceeds 64 characters", "SKILL.md", lineOf(raw, "name:"), "Shorten the skill and folder name to 64 characters or fewer."));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) findings.push(finding("structure", "error", "invalid-name", "Name must use lowercase letters, digits, and single hyphens", "SKILL.md", lineOf(raw, "name:"), "Rename the skill and folder with portable hyphen-case."));
    if (name !== folder) findings.push(finding("structure", "error", "folder-name-mismatch", `Frontmatter name '${name}' does not match folder '${folder}'`, "SKILL.md", lineOf(raw, "name:"), "Make the frontmatter name and parent folder identical."));
    if (description.length > 1024) findings.push(finding("structure", "error", "description-too-long", "Description exceeds the 1024-character compatibility limit", "SKILL.md", lineOf(raw, "description:"), "Shorten the description while preserving what and when."));
    if (!parsed.body.trim()) findings.push(finding("structure", "review", "empty-body", "SKILL.md has no instruction body", "SKILL.md", raw.split(/\r?\n/).length, "Add concise operating instructions."));
    const bodyLines = parsed.body.split(/\r?\n/).length;
    if (bodyLines > 500) findings.push(finding("structure", "review", "long-body", `SKILL.md body is ${bodyLines} lines; progressive disclosure is recommended below 500`, "SKILL.md", lineOf(raw, parsed.body), "Move detailed material into a focused reference file."));

    if (description && description.length < 40) findings.push(finding("triggers", "review", "thin-description", "Description is too short to express both capability and trigger conditions", "SKILL.md", lineOf(raw, "description:"), "State what the skill does and specific situations that should invoke it."));
    if (description && !/(?:\bwhen\b|\bwhenever\b|\basks?\b|\brequested?\b|\btrigger|\buse for\b|\buse this\b)/i.test(description)) findings.push(finding("triggers", "review", "unclear-trigger", "Description does not clearly say when this skill should trigger", "SKILL.md", lineOf(raw, "description:"), "Add concrete user phrases, tasks, file types, or situations."));
    if (/^(?:i|you|we)\b/i.test(description)) findings.push(finding("triggers", "review", "description-voice", "Description should be written as a neutral third-person capability", "SKILL.md", lineOf(raw, "description:"), "Rewrite the description in concise third-person language."));

    if (/\b(?:anthropic|claude)\b/i.test(name)) findings.push(finding("claude", "error", "claude-reserved-name", "Claude reserves 'anthropic' and 'claude' in custom skill names", "SKILL.md", lineOf(raw, "name:"), "Choose a model-neutral name."));
    if (/^allowed-tools\s*:/m.test(parsed.front)) findings.push(finding("portability", "review", "allowed-tools-extension", "allowed-tools is a model-specific frontmatter extension", "SKILL.md", lineOf(raw, "allowed-tools:"), "Document the dependency and provide a portable fallback."));
  }

  const fileNames = new Set(collected.files.map((f) => f.rel));
  for (const file of collected.files.filter((f) => !f.binary && !f.skipped)) {
    const refs = [];
    const markdown = /\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    if (file.rel === "SKILL.md") {
      while ((match = markdown.exec(file.text))) refs.push({ value: match[1].trim().replace(/^<|>$/g, ""), line: lineOf(file.text, match[0]) });
      const bare = /(?:^|[\s`'"(])((?:scripts|references|assets)\/[A-Za-z0-9._@+\/-]+)/gm;
      while ((match = bare.exec(file.text))) refs.push({ value: match[1], line: lineOf(file.text, match[1]) });
    }
    for (const ref of refs) {
      const target = ref.value.split(/[?#]/)[0];
      if (!target || /^(?:[a-z]+:|#|\/)/i.test(target)) continue;
      const resolved = path.normalize(path.join(path.dirname(file.rel), target)).split(path.sep).join("/");
      if (resolved.startsWith("../") || resolved === "..") findings.push(finding("safety", "review", "reference-escape", `Relative reference leaves the skill folder: ${ref.value}`, file.rel, ref.line, "Keep bundled references inside the skill directory."));
      else if (!fileNames.has(resolved) && !collected.files.some((item) => item.rel.startsWith(resolved.replace(/\/$/, "") + "/"))) findings.push(finding("structure", "error", "broken-reference", `Referenced file does not exist: ${ref.value}`, file.rel, ref.line, "Add the file or correct the relative path."));
    }
    if (file.rel.startsWith("references/") && file.rel.split("/").length > 2) findings.push(finding("structure", "review", "deep-reference", `Reference is nested more than one level: ${file.rel}`, file.rel, 1, "Keep references shallow so agents can discover them reliably."));
    if (file.rel.startsWith("references/") && file.text.split(/\r?\n/).length > 100 && !/^#{1,3}\s+(?:contents|table of contents)\b/im.test(file.text)) findings.push(finding("structure", "review", "reference-no-toc", `Long reference has no contents section: ${file.rel}`, file.rel, 1, "Add a short table of contents near the top."));

    const personal = file.text.match(/(?:\/Users\/[A-Za-z0-9._-]+|~\/Desktop\/|Desktop\/Workspace\/)/);
    if (personal) findings.push(finding("portability", "review", "personal-path", `Machine- or workspace-specific path found: ${personal[0]}`, file.rel, lineOf(file.text, personal[0]), "Parameterize the path or label the skill as workspace-specific."));
    const modelTool = file.text.match(/\b(?:AskUserQuestion|request_user_input|apply_patch|PreToolUse|Claude Code|Codex CLI)\b/);
    if (modelTool && file.rel !== "scripts/audit-skills.js") findings.push(finding("portability", "review", "model-specific-tool", `Model-specific capability found: ${modelTool[0]}`, file.rel, lineOf(file.text, modelTool[0]), "Document the target agent and offer an equivalent fallback where practical."));
    const destructive = file.text.match(/(?:^|[;&|]\s*)(?:rm\s+-rf|git\s+reset\s+--hard|git\s+push\s+--force|dd\s+if=)/m);
    if (destructive) findings.push(finding("safety", "review", "destructive-command", "Potentially destructive command appears in skill content", file.rel, lineOf(file.text, destructive[0]), "Confirm it is defensive documentation; otherwise remove it or require explicit human approval."));
    const codeExec = file.text.match(/\b(?:child_process\.(?:exec|spawn)|subprocess\.(?:run|Popen)|os\.system\(|eval\s*\()/);
    if (codeExec) findings.push(finding("safety", "review", "code-execution", `Bundled code contains an execution primitive: ${codeExec[0]}`, file.rel, lineOf(file.text, codeExec[0]), "Audit the call path and inputs manually; static inspection cannot prove it safe."));
    const network = file.text.match(/\b(?:curl\s+https?:|wget\s+https?:|fetch\s*\(|requests\.(?:get|post)\s*\()/);
    if (network) findings.push(finding("safety", "review", "network-access", `Potential network access found: ${network[0]}`, file.rel, lineOf(file.text, network[0]), "Verify destinations, data exposure, and user approval requirements."));
  }

  const openai = collected.files.find((f) => f.rel === "agents/openai.yaml" && !f.binary && !f.skipped);
  if (openai) {
    if (!/^interface:\s*$/m.test(openai.text)) findings.push(finding("codex", "review", "openai-yaml-interface", "agents/openai.yaml has no interface block", openai.rel, 1, "Add interface metadata or remove the unused file."));
    if (/^\s*default_prompt:\s*(.+)$/m.test(openai.text) && !openai.text.includes(`$${name}`)) findings.push(finding("codex", "review", "openai-default-prompt", "Codex default_prompt does not explicitly mention this skill", openai.rel, lineOf(openai.text, "default_prompt:"), `Mention $${name} in the default prompt.`));
    if (/^dependencies:\s*$/m.test(openai.text)) findings.push(finding("portability", "review", "declared-dependency", "Codex-specific tool dependencies are declared in agents/openai.yaml", openai.rel, lineOf(openai.text, "dependencies:"), "Verify every dependency is available and document a fallback for other agents."));
    const unsupported = openai.text.match(/^\s*-?\s*type:\s*["']?([^"'\s]+)["']?\s*$/m);
    if (unsupported && unsupported[1] !== "mcp") findings.push(finding("codex", "review", "unsupported-dependency-type", `Unknown Codex dependency type: ${unsupported[1]}`, openai.rel, lineOf(openai.text, unsupported[0]), "Use a currently supported dependency type or remove the declaration."));
  }

  const axes = {};
  for (const axis of AXES) {
    const own = findings.filter((f) => f.axis === axis);
    axes[axis] = own.some((f) => f.severity === "error") ? "fail" : own.length ? "review" : "pass";
  }
  const source = { id: root.id, label: root.label, root: displayPath(root.path), path: displayPath(dir), skillMd: displayPath(path.join(dir, "SKILL.md")) };
  return {
    id: `${name}:${digestFiles(collected.files)}`,
    name, folder, description, body: parsed.body.trim(), frontmatter: fm,
    digest: digestFiles(collected.files), fileCount: collected.files.length, totalBytes: collected.totalBytes,
    sources: [source], findings, axes, status: "Needs review", statusKey: "review",
    _descriptionForOverlap: description, _dirReal: dirReal,
  };
}

function finalizeStatus(skill) {
  const commonFail = skill.axes.structure === "fail";
  const warnings = skill.findings.filter((f) => f.severity !== "error");
  const workspace = skill.findings.some((f) => f.code === "personal-path");
  const conflict = skill.findings.some((f) => ["duplicate-name", "trigger-overlap"].includes(f.code));
  const safetyReview = skill.axes.safety !== "pass";
  if (commonFail) { skill.status = "Broken"; skill.statusKey = "broken"; }
  else if (workspace) { skill.status = "Workspace-specific"; skill.statusKey = "workspace"; }
  else if (skill.axes.claude === "pass" && skill.axes.codex !== "pass") { skill.status = "Claude-ready"; skill.statusKey = "claude"; }
  else if (skill.axes.codex === "pass" && skill.axes.claude !== "pass") { skill.status = "Codex-ready"; skill.statusKey = "codex"; }
  else if (warnings.length || conflict || safetyReview) { skill.status = "Needs review"; skill.statusKey = "review"; }
  else { skill.status = "Universal"; skill.statusKey = "universal"; }
  const rank = { error: 0, review: 1, info: 2 };
  skill.findings.sort((a, b) => (rank[a.severity] - rank[b.severity]) || AXES.indexOf(a.axis) - AXES.indexOf(b.axis) || a.file.localeCompare(b.file) || a.line - b.line);
  skill.counts = { errors: skill.findings.filter((f) => f.severity === "error").length, review: skill.findings.filter((f) => f.severity !== "error").length };
  delete skill._descriptionForOverlap;
  delete skill._dirReal;
  return skill;
}

function auditSkillRoots(options = {}) {
  const roots = normalizeRoots(options.roots);
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const candidates = [];
  const rootReports = [];

  for (const root of roots) {
    if (!fs.existsSync(root.path)) { rootReports.push({ ...root, path: displayPath(root.path), exists: false, skills: 0 }); continue; }
    let rootReal;
    try { rootReal = fs.realpathSync(root.path); } catch { rootReports.push({ ...root, path: displayPath(root.path), exists: false, skills: 0 }); continue; }
    let entries = [];
    try { entries = fs.readdirSync(root.path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { rootReports.push({ ...root, path: displayPath(root.path), exists: true, unreadable: true, skills: 0 }); continue; }
    let count = 0;
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const dir = path.join(root.path, entry.name);
      let stat;
      try { stat = fs.lstatSync(dir); } catch { continue; }
      if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
      let dirReal = "";
      let resolutionCode = "";
      try { dirReal = fs.realpathSync(dir); }
      catch (error) { resolutionCode = error && error.code ? error.code : "unresolved"; }
      if (!dirReal || !inside(rootReal, dirReal)) {
        const unresolved = Boolean(resolutionCode);
        const code = unresolved ? "symlink-root-unresolved" : "symlink-root-escape";
        const digest = refusedSymlinkDigest([code, entry.name, displayPath(root.path), displayPath(dir), unresolved ? resolutionCode : displayPath(dirReal)]);
        const ghost = {
          id: `${entry.name}:${digest}`, name: entry.name, folder: entry.name, description: "", body: "", frontmatter: {}, digest,
          fileCount: 0, totalBytes: 0, sources: [{ id: root.id, label: root.label, root: displayPath(root.path), path: displayPath(dir), skillMd: displayPath(path.join(dir, "SKILL.md")) }],
          findings: [finding("safety", "review", code, unresolved ? `Refused unresolved skill symlink (${resolutionCode})` : `Refused skill symlink escaping ${displayPath(root.path)}`, "SKILL.md", 1, "Place the skill inside the declared root or audit the linked target separately.")],
          axes: { structure: "review", triggers: "pass", safety: "review", portability: "pass", claude: "pass", codex: "pass" }, status: "Needs review", statusKey: "review", _descriptionForOverlap: "", _dirReal: "",
        };
        candidates.push(ghost); count++; continue;
      }
      candidates.push(auditCandidate({ root, rootReal, dir, dirReal, folder: entry.name }, limits));
      count++;
    }
    rootReports.push({ ...root, path: displayPath(root.path), exists: true, skills: count });
  }

  const unique = [];
  const byDigest = new Map();
  for (const skill of candidates) {
    const key = skill.digest ? `${skill.name}\0${skill.digest}` : `${skill.name}\0${skill.sources[0].path}`;
    if (byDigest.has(key)) byDigest.get(key).sources.push(...skill.sources);
    else { byDigest.set(key, skill); unique.push(skill); }
  }

  const byName = new Map();
  for (const skill of unique) {
    const list = byName.get(skill.name) || [];
    list.push(skill); byName.set(skill.name, list);
  }
  for (const [name, list] of byName) if (list.length > 1) for (const skill of list) {
    skill.findings.push(finding("portability", "review", "duplicate-name", `${list.length} different skills share the name '${name}'`, "SKILL.md", 1, "Rename or consolidate the conflicting implementations."));
    skill.axes.portability = "review";
  }
  for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
    if (unique[i].name === unique[j].name) continue;
    const score = overlapScore(unique[i]._descriptionForOverlap, unique[j]._descriptionForOverlap);
    if (score < 0.72) continue;
    for (const [a, b] of [[unique[i], unique[j]], [unique[j], unique[i]]]) {
      a.findings.push(finding("triggers", "review", "trigger-overlap", `Likely trigger overlap with '${b.name}' (${Math.round(score * 100)}% token overlap)`, "SKILL.md", 1, "Make each description's invocation boundary more specific."));
      a.axes.triggers = "review";
    }
  }

  unique.forEach(finalizeStatus);
  const statusRank = { broken: 0, review: 1, workspace: 2, claude: 3, codex: 3, universal: 4 };
  unique.sort((a, b) => (statusRank[a.statusKey] - statusRank[b.statusKey]) || a.name.localeCompare(b.name));
  const statuses = { universal: 0, claude: 0, codex: 0, workspace: 0, review: 0, broken: 0 };
  unique.forEach((skill) => { statuses[skill.statusKey] = (statuses[skill.statusKey] || 0) + 1; });
  return {
    schemaVersion: 1,
    checkerVersion: CHECKER_VERSION,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    disclaimer: "Static contract evidence only — no scripts executed, no network used, and no runtime behavior guaranteed.",
    roots: rootReports,
    summary: { skills: unique.length, mirrors: candidates.length - unique.length, findings: unique.reduce((n, s) => n + s.findings.length, 0), statuses },
    skills: unique,
  };
}

function parseCli(argv) {
  const roots = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--version") return { version: true };
    else if (argv[i] === "--root") {
      const spec = argv[++i] || "";
      const split = spec.indexOf("=");
      roots.push({ id: split > 0 ? spec.slice(0, split) : `root-${roots.length + 1}`, label: split > 0 ? spec.slice(0, split) : `Root ${roots.length + 1}`, path: split > 0 ? spec.slice(split + 1) : spec });
    } else if (argv[i] === "--help" || argv[i] === "-h") return { help: true };
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return { roots, json };
}

function printHuman(report) {
  const s = report.summary.statuses;
  console.log(`Skill Doctor — ${report.summary.skills} unique skills (${report.summary.mirrors} identical mirrors)`);
  console.log(`Universal ${s.universal} · Claude-ready ${s.claude} · Codex-ready ${s.codex} · Workspace-specific ${s.workspace} · Needs review ${s.review} · Broken ${s.broken}`);
  console.log(report.disclaimer);
  for (const skill of report.skills) {
    console.log(`\n${skill.status.padEnd(18)} ${skill.name}  [${skill.sources.map((x) => x.label).join(", ")}]`);
    for (const item of skill.findings.slice(0, 8)) console.log(`  ${item.severity === "error" ? "ERROR" : "REVIEW"} ${item.axis} · ${item.file}:${item.line} · ${item.message}`);
    if (skill.findings.length > 8) console.log(`  … ${skill.findings.length - 8} more findings`);
  }
}

if (require.main === module) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.version) {
      console.log(CHECKER_VERSION);
      process.exit(0);
    }
    if (cli.help) {
      console.log("Usage: node scripts/audit-skills.js [--json] [--root label=/absolute/path]");
      process.exit(0);
    }
    const report = auditSkillRoots({ roots: cli.roots });
    if (cli.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n"); else printHuman(report);
    process.exitCode = report.summary.statuses.broken ? 2 : 0;
  } catch (error) {
    console.error(`Skill Doctor failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { AXES, DEFAULT_LIMITS, auditSkillRoots, parseFrontmatter, overlapScore };
