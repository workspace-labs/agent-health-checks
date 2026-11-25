#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { isUtf8 } = require("node:buffer");

const AXES = ["structure", "triggers", "safety", "portability", "claude", "codex"];
const CHECKER_VERSION = "0.6.0";
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 320, maxFileBytes: 1024 * 1024, maxTotalBytes: 6 * 1024 * 1024 });
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".pdf", ".zip", ".gz", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".mov"]);
const UNREAD_DIRS = new Set(["node_modules", "__pycache__"]);
const DESKTOP_METADATA = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function comparePath(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

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

function collectFiles(skillDir, rootReal, limits, discoveryDepth = Infinity) {
  const files = [];
  const notices = [];
  let totalBytes = 0;
  let ordinaryFiles = 0;
  let ordinaryBytes = 0;
  let omitted = 0;
  let limited = false;

  function list(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => comparePath(a.name, b.name));
    } catch (error) {
      notices.push({ code: "unreadable-directory", message: `Could not read ${displayPath(dir)}: ${error.message}` });
      return [];
    }
  }

  // Only list names and types in skipped dependency trees. A link is never a subtree.
  function countExcluded(dir, rel) {
    let count = 0;
    for (const entry of list(dir)) {
      if (entry.isDirectory() && entry.name !== ".git") {
        count += countExcluded(path.join(dir, entry.name), rel + "/" + entry.name);
      } else if (entry.isFile()) count++;
    }
    if (UNREAD_DIRS.has(path.basename(dir))) {
      notices.push({ code: "unread-directory", file: rel, message: `Skipped ${rel} (unread files: ${count})` });
    }
    return count;
  }

  function skipLink(absolute, rel) {
    let real;
    let resolutionCode;
    try { real = fs.realpathSync(absolute); }
    catch (error) { resolutionCode = error.code || "unresolved"; }
    notices.push({
      code: resolutionCode ? "symlink-unresolved" : "symlink-skipped",
      message: resolutionCode
        ? `Skipped unresolved symlink (${resolutionCode}): ${displayPath(absolute)}`
        : !inside(rootReal, real) ? `Refused symlink escaping its root: ${displayPath(absolute)}` : `Skipped symlink: ${displayPath(absolute)}`,
      file: rel,
    });
  }

  function read(rel, priority) {
    if (!priority && (limited || ordinaryFiles >= limits.maxFiles || ordinaryBytes >= limits.maxTotalBytes)) {
      limited = true;
      omitted++;
      return;
    }
    const absolute = path.join(skillDir, rel);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch {
      notices.push({ code: "unreadable-file", message: `Could not read ${rel}`, file: rel });
      return;
    }
    if (stat.isSymbolicLink()) { skipLink(absolute, rel); return; }
    if (!stat.isFile()) return;
    if (stat.size > limits.maxFileBytes) {
      notices.push({ code: "oversized-file", message: `Skipped ${rel}; it exceeds ${limits.maxFileBytes} bytes`, file: rel });
      files.push({ rel, size: stat.size, binary: true, skipped: true, hash: `oversized:${stat.size}` });
      if (!priority) ordinaryFiles++;
      omitted++;
      return;
    }
    if (!priority && ordinaryBytes + stat.size > limits.maxTotalBytes) {
      limited = true;
      omitted++;
      return;
    }
    let buffer;
    try { buffer = fs.readFileSync(absolute); } catch {
      notices.push({ code: "unreadable-file", message: `Could not read ${rel}`, file: rel });
      return;
    }
    if (!priority) {
      ordinaryBytes += buffer.length;
      ordinaryFiles++;
    }
    totalBytes += buffer.length;
    const binary = isBinary(buffer, rel);
    const text = binary ? "" : buffer.toString("utf8");
    const hashInput = !binary && isUtf8(buffer) ? text.replace(/\r\n/g, "\n") : buffer;
    const hash = crypto.createHash("sha256").update(hashInput).digest("hex");
    files.push({ rel, size: buffer.length, binary, skipped: false, hash, text });
  }

  const rootEntries = list(skillDir);
  const agents = rootEntries.find(entry => entry.name === "agents" && entry.isDirectory());
  const hasSkill = rootEntries.some(entry => entry.name === "SKILL.md" && entry.isFile());
  if (hasSkill) read("SKILL.md", true);
  const agentEntries = agents ? list(path.join(skillDir, "agents")) : [];
  const hasOpenai = agentEntries.some(entry => entry.name === "openai.yaml" && entry.isFile());
  if (hasOpenai) read("agents/openai.yaml", true);

  function walk(entries, parent, depth) {
    for (const entry of entries) {
      const rel = parent ? parent + "/" + entry.name : entry.name;
      const absolute = path.join(skillDir, rel);
      if (entry.isSymbolicLink()) { skipLink(absolute, rel); continue; }
      if (entry.isDirectory()) {
        if (entry.name === ".git" || depth >= discoveryDepth) continue;
        if (UNREAD_DIRS.has(entry.name)) {
          if (discoveryDepth === Infinity) countExcluded(absolute, rel);
        } else {
          walk(rel === "agents" ? agentEntries : list(absolute), rel, depth + 1);
        }
      } else if (entry.isFile() && !DESKTOP_METADATA.has(entry.name)) {
        if ((hasSkill && rel === "SKILL.md") || (hasOpenai && rel === "agents/openai.yaml")) continue;
        read(rel, false);
      }
    }
  }

  walk(rootEntries, "", 0);
  if (limited) notices.push({ code: "scan-limit", message: `Stopped at the bounded scan limit (${limits.maxFiles} files / ${limits.maxTotalBytes} bytes)` });
  if (omitted) notices.push({ code: "unread-files", message: `Files not read because of scan limits: ${omitted}` });
  return { files, notices, totalBytes };
}

function digestFiles(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files.slice().sort((a, b) => comparePath(a.rel, b.rel))) hash.update(file.rel).update("\0").update(file.hash).update("\0");
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

// Markdown destinations use the containing document. Instruction paths beginning with a
// bundled folder or the skill-directory variable use the skill's installation directory.
function referencesIn(file, bundleFolders) {
  const refs = new Map();
  const yaml = file.rel === "agents/openai.yaml";
  if (!yaml && !/\.md$/i.test(file.rel)) return refs.values();
  const variable = "${CLAUDE_SKILL_DIR}/";
  let fence = "";
  let shell = false;
  const lines = file.text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const delimiter = !yaml && line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) {
        fence = delimiter[1];
        shell = /^\s*(?:bash|sh|shell|zsh|fish|console)\s*$/i.test(line.slice(delimiter[0].length));
      } else if (delimiter[1].startsWith(fence)) fence = "";
      continue;
    }
    if (fence && !shell) continue;

    function add(raw, link, instruction) {
      let value = raw.trim();
      if (!link) value = value.replace(/[.,;:!?]+$/, "").replace(/:\d+(?::\d+)?$/, "");
      if (!value || value.startsWith("#")) return;
      const scheme = /^[a-z][a-z\d+.-]*:/i.test(value);
      if (scheme && !/^file:/i.test(value) && !path.win32.isAbsolute(value)) return;
      try { value = decodeURIComponent(value.split(/[?#]/)[0]); } catch { /* Verify the literal spelling. */ }
      const anchored = value.startsWith(variable);
      const target = anchored ? value.slice(variable.length) : value;
      if (!target || /[<>{}*]|\.\.\.|(?:^|\/)path\/to(?:\/|$)/.test(target) || target === "URL") return;
      const absolute = /^(?:~(?:\/|$)|\/|file:)/i.test(target) || path.win32.isAbsolute(target);
      const bundled = bundleFolders.has(target.split("/")[0]);
      const explicit = anchored || target.startsWith("./") || bundled;
      // Filenames mentioned as examples or source-tree conventions do not direct the
      // reader to open them. Ambiguous file operands in instructions still get reviewed.
      const fileLike = /(?:^|\/)[^./\s][^/]*\.[a-z\d]{1,12}$/i.test(target);
      const operand = instruction && (absolute ? !target.endsWith("/") : fileLike);
      if (!link && !(explicit && !target.endsWith("/")) && !operand) return;
      const base = yaml || anchored || (!link && bundled) ? "." : path.posix.dirname(file.rel);
      const tryRoot = !link && !absolute && base !== "." && target.startsWith("./");
      const ref = { value, target, base, absolute, tryRoot, certain: link || explicit, line: i + 1 };
      const identity = JSON.stringify([ref.line, base, target]);
      if (!refs.has(identity) || ref.certain) refs.set(identity, ref);
    }

    // Consume a whole link (including its label and title) once. Recognize balanced
    // parentheses in unquoted destinations, and spaces in angle-bracket destinations.
    const destination = /^(?:<([^>]+)>|((?:\\.|[^()\s\\]|\((?:\\.|[^()\\])*\))+))/;
    const definition = !yaml && line.match(/^\s{0,3}\[[^\]]+\]:\s*(.*)$/);
    if (definition) {
      const match = definition[1].match(destination);
      if (match) add(match[1] || match[2], true, false);
      continue;
    }
    const token = /`([^`]+)`|\[([^\[\]]*)\]\(\s*|(?:^|[\s'"(=])((?:\$\{CLAUDE_SKILL_DIR\}\/|\.\.?\/|\/|[\p{L}\p{M}\p{N}_@+.~-]+\/)[^\s'"`\])]+|[\p{L}\p{M}\p{N}_@+~-]+(?:\.[\p{L}\p{M}\p{N}_@+-]+)+)|<(img|a)\b((?:"[^"]*"|'[^']*'|[^'"<>])*)>/giu;
    let match;
    const firstWord = line.search(/\S/);
    while ((match = token.exec(line))) {
      const prefix = line.slice(Math.max(0, match.index - 100), match.index);
      const instruction = yaml || match.index <= firstWord || /(?:^|[.!?:;>,–—-]|\b(?:and|or|then|please|to|can|should|must))\s*(?:read|run|open|use|load|see|consult|include|execute|source|check|refer to)(?:\s+(?:the|a|this|file|script|guide|document|in|at|from)){0,4}\s*:?\s*$/i.test(prefix);
      if (match[4] !== undefined) {
        if (fence) continue;
        const wanted = match[4].toLowerCase() === "img" ? "src" : "href";
        const attributes = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
        for (const attr of match[5].matchAll(attributes)) {
          if (attr[1].toLowerCase() === wanted) add(attr[2] || attr[3] || attr[4] || "", true, false);
        }
      } else if (match[2] !== undefined) {
        if (fence) continue;
        let destinationLine = i;
        let offset = token.lastIndex;
        if (!line.slice(offset).trim() && i + 1 < lines.length) {
          destinationLine++;
          offset = lines[destinationLine].search(/\S/);
          if (offset < 0) continue;
        }
        const dest = lines[destinationLine].slice(offset).match(destination);
        if (!dest) continue;
        let lastLine = destinationLine;
        let endOffset = offset + dest[0].length;
        const suffix = lines[lastLine].slice(endOffset);
        const closing = /^\s*(?:"[^"]*"|'[^']*'|\([^()]*\))?\s*\)/;
        let end = suffix.match(closing);
        if (!end && /^\s*(?:"[^"]*"|'[^']*'|\([^()]*\))?\s*$/.test(suffix) && lastLine + 1 < lines.length) {
          lastLine++;
          endOffset = 0;
          end = lines[lastLine].match(closing);
        }
        if (!end) continue;
        add((dest[1] || dest[2]).replace(/\\([()])/g, "$1"), true, false);
        if (lastLine === i) token.lastIndex = endOffset + end[0].length;
        else {
          for (let j = i + 1; j < lastLine; j++) lines[j] = "";
          lines[lastLine] = lines[lastLine].slice(endOffset + end[0].length);
          break;
        }
      } else if (match[1] !== undefined) {
        // A code span can contain either a single path (including spaces) or a command.
        const span = match[1];
        const words = Array.from(span.matchAll(/"([^"]+)"|'([^']+)'|([^\s]+)/g), w => w[1] || w[2] || w[3]);
        const first = words[0] || "";
        const isCommand = words.length > 1 && (!first.includes("/") || /\.[\w-]+$/.test(first) ||
          words.some(word => /^--?\w/.test(word)) || !/\.[\w-]+$/.test(span));
        if (isCommand) {
          for (let w = 0; w < words.length; w++) {
            if (["--output", "--output-dir", "-o"].includes(words[w - 1])) continue;
            if (!words[w].startsWith("-") && words[w].includes("/")) add(words[w], false, instruction);
          }
        } else add(span, false, instruction);
      } else if (!/(?:^|\s)(?:--output(?:-dir)?|-o)\s*=?\s*$/.test(prefix)) {
        add(match[3], false, instruction);
      }
    }
  }
  return refs.values();
}

function referenceInspector(skillDir) {
  // Cache only directory entries. Each segment must match case, even on a volume
  // where asking the OS for a wrong-case path would succeed.
  const directories = new Map();
  function entries(dir) {
    if (!directories.has(dir)) {
      try { directories.set(dir, new Map(fs.readdirSync(dir, { withFileTypes: true }).map(entry => [entry.name, entry]))); }
      catch { directories.set(dir, null); }
    }
    return directories.get(dir);
  }
  const bundleFolders = new Set();
  for (const entry of entries(skillDir)?.values() || []) {
    if (entry.isDirectory() || entry.isSymbolicLink()) bundleFolders.add(entry.name);
  }
  function inspect(ref) {
    let start = path.resolve(skillDir, ref.base);
    let target = ref.target;
    if (ref.absolute) {
      if (target.startsWith("~/")) target = path.join(os.homedir(), target.slice(2));
      if (!path.isAbsolute(target) || !inside(skillDir, target)) return "unknown";
      target = path.relative(skillDir, target).split(path.sep).join("/");
      start = skillDir;
    }
    let parts = target.split("/");
    let links = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part === ".") continue;
      if (part === "..") {
        start = path.dirname(start);
        if (!inside(skillDir, start)) return "escape";
        continue;
      }
      const names = entries(start);
      if (!names) return "unknown";
      const entry = names.get(part);
      if (!entry) return "missing";
      const current = path.join(start, part);
      if (entry.isSymbolicLink()) {
        if (++links > 40) return "unknown";
        let link;
        try { link = fs.readlinkSync(current); } catch { return "unknown"; }
        if (!inside(skillDir, path.resolve(start, link))) return "unknown";
        if (path.isAbsolute(link)) { link = path.relative(skillDir, link); start = skillDir; }
        parts = [...link.split(path.sep), ...parts.slice(i + 1)];
        i = -1;
      } else {
        if (i + 1 < parts.length && !entry.isDirectory()) return "missing";
        if (!entry.isFile() && !entry.isDirectory()) return "unknown";
        if (i + 1 < parts.length && part === ".git") return "unknown";
        start = current;
      }
    }
    return "present";
  }
  return { bundleFolders, inspect };
}

function auditCandidate(candidate, limits) {
  const { root, rootReal, dir, dirReal, folder } = candidate;
  const collected = collectFiles(dirReal, rootReal, limits, candidate.discoveryDepth);
  const skillFile = collected.files.find((f) => f.rel === "SKILL.md" && !f.binary && !f.skipped);
  const findings = [];
  for (const note of collected.notices) findings.push(finding(note.code.startsWith("symlink-") ? "safety" : "structure", "review", note.code, note.message, note.file || "SKILL.md", 1));

  let parsed = { ok: false, fm: {}, body: "", front: "", error: "SKILL.md is missing or unreadable" };
  if (skillFile) parsed = parseFrontmatter(skillFile.text);
  const oversizedSkill = collected.files.some(f => f.rel === "SKILL.md" && f.skipped);
  if (!skillFile && !oversizedSkill) findings.push(finding("structure", "error", "missing-skill-md", "The skill directory has no readable SKILL.md", "SKILL.md", 1, "Add a SKILL.md with valid YAML frontmatter."));
  else if (skillFile && !parsed.ok) findings.push(finding("structure", "error", "malformed-frontmatter", parsed.error, "SKILL.md", 1, "Repair the opening YAML frontmatter and its closing delimiter."));

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

  const inspector = referenceInspector(dirReal);
  for (const file of collected.files.filter((f) => !f.binary && !f.skipped)) {
    for (const ref of referencesIn(file, inspector.bundleFolders)) {
      let state = inspector.inspect(ref);
      if (ref.tryRoot && state !== "present") {
        const alternative = inspector.inspect({ ...ref, base: "." });
        if (state === "missing" || alternative === "present") state = alternative;
      }
      if (state === "present") continue;
      if (state === "escape") findings.push(finding("safety", "review", "reference-escape", `Relative reference leaves the skill folder: ${ref.value}`, file.rel, ref.line, "Keep bundled references inside the skill directory."));
      else if (state === "missing" && ref.certain) findings.push(finding("structure", "error", "broken-reference", `Referenced file does not exist: ${ref.value}`, file.rel, ref.line, "Add the file or correct the relative path."));
      else findings.push(finding("structure", "review", "unverified-reference", `Could not verify reference: ${ref.value}`, file.rel, ref.line, "Confirm the intended location before changing this reference."));
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
  const source = sourceLocation(root, dir);
  const digest = digestFiles(collected.files);
  return {
    id: `${name}:${digest}`,
    name, folder, description, body: parsed.body.trim(), frontmatter: fm,
    digest, fileCount: collected.files.length, totalBytes: collected.totalBytes,
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
  skill.findings.sort((a, b) => (rank[a.severity] - rank[b.severity]) || AXES.indexOf(a.axis) - AXES.indexOf(b.axis) || comparePath(a.file, b.file) || a.line - b.line);
  skill.counts = { errors: skill.findings.filter((f) => f.severity === "error").length, review: skill.findings.filter((f) => f.severity !== "error").length };
  delete skill._descriptionForOverlap;
  delete skill._dirReal;
  return skill;
}

function sourceLocation(root, dir) {
  return { id: root.id, label: root.label, root: displayPath(root.path), path: displayPath(dir), skillMd: displayPath(path.join(dir, "SKILL.md")) };
}

function inspectRoot(root) {
  const report = { ...root, path: displayPath(root.path), exists: false, skills: 0, state: "unreadable" };
  let real;
  try {
    real = fs.realpathSync(root.path);
    report.exists = true;
    if (!fs.statSync(real).isDirectory()) {
      report.unreadable = true;
      report.state = "not a folder";
    } else {
      const entries = fs.readdirSync(real, { withFileTypes: true });
      report.state = "read";
      return { root, real, entries, report };
    }
  } catch (error) {
    if (report.exists) report.unreadable = true;
    if (error.code === "ENOENT" || error.code === "ENOTDIR") report.state = "missing";
  }
  return { root, real, report };
}

function hasGuide(entries) {
  return entries.some(entry => entry.name === "SKILL.md" && (entry.isFile() || entry.isSymbolicLink()));
}

function discoveryDirectory(name) {
  return name !== ".git" && name !== "node_modules";
}

function discoverInstalls(context, add, links) {
  const { root, real, entries, report } = context;
  if (hasGuide(entries)) {
    add(context, root.path, real);
    return;
  }

  function search(dir, realDir, depth, result) {
    let children;
    try { children = fs.readdirSync(realDir, { withFileTypes: true }); }
    catch { result.unreadable = true; return; }
    if (hasGuide(children)) {
      add(context, dir, realDir);
      result.skills++;
      return;
    }
    for (const entry of children) {
      if (!entry.isDirectory()) {
        result.populated = true;
      } else if (depth < 3 && discoveryDirectory(entry.name)) {
        search(path.join(dir, entry.name), path.join(realDir, entry.name), depth + 1, result);
      }
    }
  }

  for (const entry of entries) {
    if (!discoveryDirectory(entry.name)) continue;
    const dir = path.join(root.path, entry.name);
    if (entry.isSymbolicLink()) {
      links.push({ context, dir });
    } else if (entry.isDirectory()) {
      const realDir = path.join(real, entry.name);
      const result = { skills: 0, populated: false, unreadable: false };
      search(dir, realDir, 1, result);
      if (result.skills && !context.locations.has(realDir)) {
        (report.containers ||= []).push({ name: entry.name, skills: result.skills });
      } else if (!result.skills && (result.populated || result.unreadable)) {
        add(context, dir, realDir, 2);
      }
    }
  }
  if (report.containers) report.containers.sort((a, b) => comparePath(a.name, b.name));
}

function refusedLink(context, dir, target, errorCode) {
  const { root } = context;
  const folder = path.basename(dir);
  const code = errorCode ? "symlink-root-unresolved" : "symlink-root-escape";
  const axis = errorCode ? "safety" : "structure";
  const detail = errorCode || displayPath(target);
  const digest = refusedSymlinkDigest([code, folder, displayPath(root.path), displayPath(dir), detail]);
  const message = errorCode ? `Refused unresolved skill symlink (${detail})`
    : `Refused skill symlink escaping ${displayPath(root.path)}. Target ${detail} was not checked.`;
  return {
    id: `${folder}:${digest}`, name: folder, folder, description: "", body: "", frontmatter: {}, digest,
    fileCount: 0, totalBytes: 0, sources: [sourceLocation(root, dir)],
    findings: [finding(axis, "review", code, message, "SKILL.md", 1, "Place the skill inside the declared root or audit the linked target separately.")],
    axes: { structure: "review", triggers: "pass", safety: errorCode ? "review" : "pass", portability: "pass", claude: "pass", codex: "pass" },
    status: "Needs review", statusKey: "review", _descriptionForOverlap: "", _dirReal: "",
  };
}

function mergeInstallations(copies) {
  // Stable representative and finding order, even when the caller reverses its roots.
  copies.sort((a, b) => comparePath(a._dirReal, b._dirReal));
  const first = copies[0];
  if (copies.length === 1) return first;
  const seen = new Set();
  const findings = [];
  const sources = [];
  const axes = { ...first.axes };
  for (const copy of copies) {
    sources.push(...copy.sources);
    for (const item of copy.findings) {
      const identity = JSON.stringify(item);
      if (!seen.has(identity)) {
        seen.add(identity);
        findings.push(item);
      }
    }
    for (const axis of AXES) {
      if (copy.axes[axis] === "fail" || axes[axis] === "pass") axes[axis] = copy.axes[axis];
    }
  }
  return { ...first, sources, findings, axes };
}

function auditSkillRoots(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const contexts = normalizeRoots(options.roots).map(inspectRoot);
  const readable = contexts.filter(context => context.report.state === "read");
  const candidates = [];
  const links = [];
  const physical = new Map();
  const sourceOrder = new Map();
  const statusRank = { broken: 0, review: 1, workspace: 2, claude: 3, codex: 3, universal: 4 };
  const worstCopy = new Map();

  function add(context, dir, dirReal, discoveryDepth) {
    const skill = auditCandidate({ root: context.root, rootReal: context.real, dir, dirReal, folder: path.basename(dir), discoveryDepth }, limits);
    context.locations.add(dirReal);
    context.report.skills++;
    sourceOrder.set(skill.sources[0], context);
    candidates.push(skill);
    if (discoveryDepth === undefined) physical.set(dirReal, skill);
    return skill;
  }

  for (const context of readable) {
    context.locations = new Set();
    discoverInstalls(context, add, links);
  }
  for (const { context, dir } of links) {
    let real, errorCode;
    try { real = fs.realpathSync(dir); } catch (error) { errorCode = error.code || "unresolved"; }
    const owners = real ? readable.filter(owner => inside(owner.real, real)) : [];
    if (errorCode || !owners.length) {
      const skill = refusedLink(context, dir, real, errorCode);
      sourceOrder.set(skill.sources[0], context);
      candidates.push(skill);
      context.report.skills++;
      continue;
    }
    let skill = physical.get(real);
    if (!skill) {
      // A top-level link can explicitly install a skill deeper than automatic discovery.
      // Overlapping scan roots own explicit targets from the nearest root outward.
      owners.sort((a, b) => b.real.length - a.real.length || comparePath(a.root.path, b.root.path)
        || comparePath(a.root.id, b.root.id) || comparePath(a.root.label, b.root.label));
      const owner = owners.find(item => path.relative(item.real, real).split(path.sep).every(discoveryDirectory));
      if (!owner) continue;
      let entries;
      try { entries = fs.readdirSync(real, { withFileTypes: true }); } catch { continue; }
      if (!hasGuide(entries)) continue;
      const target = path.join(owner.root.path, path.relative(owner.real, real));
      skill = add(owner, target, real);
    }
    const source = { ...sourceLocation(context.root, dir), isLink: true };
    sourceOrder.set(source, context);
    skill.sources.push(source);
    context.report.skills++;
  }

  const groups = new Map();
  for (const skill of candidates) {
    if (!groups.has(skill.id)) groups.set(skill.id, []);
    groups.get(skill.id).push(skill);
  }
  const unique = [], byName = new Map();
  let mirrors = 0;
  for (const copies of groups.values()) {
    const skill = mergeInstallations(copies);
    unique.push(skill);
    if (!skill._dirReal) continue; // Unread refusals are not content or name conflicts.
    const installsByRoot = new Map();
    for (const copy of copies) {
      const root = sourceOrder.get(copy.sources[0]).real;
      if (!installsByRoot.has(root)) installsByRoot.set(root, new Set());
      installsByRoot.get(root).add(copy._dirReal);
      if (copies.length > 1) {
        const { status, statusKey } = finalizeStatus({ ...copy, findings: [...copy.findings] });
        if (!worstCopy.has(skill) || statusRank[statusKey] < statusRank[worstCopy.get(skill).statusKey]) {
          worstCopy.set(skill, { status, statusKey });
        }
      }
    }
    const multiplicity = Math.max(...Array.from(installsByRoot.values(), paths => paths.size));
    mirrors += new Set(copies.map(copy => copy._dirReal)).size - multiplicity;
    const group = byName.get(skill.name) || { cards: [], count: 0 };
    group.cards.push(skill);
    group.count += multiplicity;
    byName.set(skill.name, group);
    skill.sources.sort((a, b) => contexts.indexOf(sourceOrder.get(a)) - contexts.indexOf(sourceOrder.get(b)) || comparePath(a.path, b.path));
  }
  for (const [name, { cards, count }] of byName) if (count > 1) for (const skill of cards) {
    skill.findings.push(finding("portability", "review", "duplicate-name", `${count} different skills share the name '${name}'`, "SKILL.md", 1, "Rename or consolidate the conflicting implementations."));
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

  for (const skill of unique) {
    finalizeStatus(skill);
    const worst = worstCopy.get(skill);
    if (worst && statusRank[worst.statusKey] < statusRank[skill.statusKey]) Object.assign(skill, worst);
  }
  unique.sort((a, b) => (statusRank[a.statusKey] - statusRank[b.statusKey]) || comparePath(a.name, b.name) || comparePath(a.digest, b.digest));
  const statuses = { universal: 0, claude: 0, codex: 0, workspace: 0, review: 0, broken: 0 };
  unique.forEach(skill => { statuses[skill.statusKey]++; });
  return {
    schemaVersion: 1,
    checkerVersion: CHECKER_VERSION,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    disclaimer: "Static contract evidence only — no scripts executed, no network used, and no runtime behavior guaranteed.",
    roots: contexts.map(context => context.report),
    summary: { skills: unique.length, mirrors, findings: unique.reduce((n, s) => n + s.findings.length, 0), statuses },
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
      const spec = argv[++i];
      if (!spec || spec.startsWith("-")) throw new Error("--root requires a path");
      const split = spec.indexOf("=");
      const prefix = spec.slice(0, split);
      const labelled = split > 0 && !/[\\/:]/.test(prefix) && !/^[.~]/.test(prefix);
      const rootPath = labelled ? spec.slice(split + 1) : spec;
      if (!rootPath.trim()) throw new Error("--root requires a path");
      roots.push({ id: labelled ? prefix : `root-${roots.length + 1}`, label: labelled ? prefix : `Root ${roots.length + 1}`, path: rootPath });
    } else if (argv[i] === "--help" || argv[i] === "-h") return { help: true };
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return { roots, json };
}

function printHuman(report, explicitRoots) {
  for (const root of report.roots) {
    if (explicitRoots || root.state !== "missing") console.log(`${root.label} (${root.path}) — ${root.state}`);
  }
  const s = report.summary.statuses;
  console.log(`Skill Doctor — ${report.summary.skills} unique skills (${report.summary.mirrors} identical mirrors)`);
  console.log(`Universal ${s.universal} · Claude-ready ${s.claude} · Codex-ready ${s.codex} · Workspace-specific ${s.workspace} · Needs review ${s.review} · Broken ${s.broken}`);
  console.log(report.disclaimer);
  for (const skill of report.skills) {
    console.log(`\n${skill.status.padEnd(18)} ${skill.name}  [${skill.sources.map(source => source.isLink ? source.label + " (link)" : source.label).join(", ")}]`);
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
    if (cli.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n"); else printHuman(report, cli.roots.length > 0);
    const rootError = cli.roots.length > 0 && report.roots.some(root => root.state !== "read");
    process.exitCode = rootError ? 1 : report.summary.statuses.broken ? 2 : 0;
  } catch (error) {
    console.error(`Skill Doctor failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { AXES, DEFAULT_LIMITS, auditSkillRoots, parseFrontmatter, overlapScore };
