#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { isUtf8 } = require("node:buffer");

const AXES = ["structure", "triggers", "safety", "portability", "claude", "codex"];
const CHECKER_VERSION = "0.9.0";
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

function scalar(value) {
  return typeof value === "string" ? value.trim() : "";
}

// A bounded YAML subset for the two metadata documents. Keep the source line
// with each mapping key, including separate entries in a sequence of maps.
function readYaml(source, firstLine) {
  const rows = source.split(/\r?\n/).map((text, index) => {
    const indent = /^ */.exec(text)[0].length;
    return { text, indent, content: text.slice(indent), line: firstLine + index };
  });
  const positions = new WeakMap();
  const unknownFields = new Set();
  let issue;
  let unknownKeys = false;
  let cursor = 0;
  function flag(code, row) {
    if (!issue || (code === "invalid-yaml" && issue.code !== code)) issue = { code, line: row.line };
  }
  function next() {
    while (cursor < rows.length && (!rows[cursor].content || rows[cursor].content.startsWith("#"))) cursor++;
    const row = rows[cursor];
    if (row?.content.startsWith("\t")) flag("invalid-yaml", row);
    return row;
  }
  function map() {
    const value = Object.create(null);
    positions.set(value, Object.create(null));
    return value;
  }
  const isItem = content => /^-(?:\s|$)/.test(content);
  const keyPattern = /^(?:(['"])([\w.-]+)\1|([\w.-]+))[ \t]*:(?:[ \t]+(.*)|$)/;
  function withoutComment(text) {
    const match = /(?:^|[ \t])#/.exec(text);
    return (match ? text.slice(0, match.index) : text).trimEnd();
  }
  function plain(text, row) {
    const clean = withoutComment(text);
    if (/:(?:\s|$)/.test(clean)) flag("invalid-yaml", row);
    return clean;
  }
  function flowList(text, row) {
    const values = [];
    positions.set(values, []);
    // A flat sequence of ordinary quoted or plain scalars. A sticky cursor
    // makes commas inside quotes unambiguous and never retries a failed token.
    const item = /[ \t]*('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[\w.-]+(?:[ \t]+[\w.-]+)*)[ \t]*([,\]])/y;
    const trailingClose = /[ \t]*\]$/y;
    item.lastIndex = 1;
    while (item.lastIndex < text.length) {
      const match = item.exec(text);
      if (!match || !match[1].trim()) return undefined;
      const value = inline(match[1].trim(), row);
      if (value === undefined) return undefined;
      values.push(value);
      positions.get(values).push(row.line);
      if (match[2] === "]") return item.lastIndex === text.length ? values : undefined;
      trailingClose.lastIndex = item.lastIndex;
      if (trailingClose.test(text)) return values;
    }
  }
  function inline(text, row) {
    if (text.startsWith("'")) {
      const match = /^'((?:[^']|'')*)'(?:\s+#.*)?\s*$/.exec(text);
      if (match) return match[1].replace(/''/g, "'");
    } else if (text.startsWith('"')) {
      const match = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?\s*$/.exec(text);
      if (match) {
        try { return JSON.parse(match[1]); } catch { /* YAML also has non-JSON escapes. */ }
      }
    } else {
      const clean = withoutComment(text);
      if (clean === "{}") return map();
      if (clean === "[]") return [];
      if (clean.startsWith("[") && clean.endsWith("]")) {
        const list = flowList(clean, row);
        if (list) return list;
      }
      if (!/^[&*!\[\]{}|>@`%]|^[?:-](?:\s|$)/.test(clean)) return plain(text, row);
    }
    flag("unverified-yaml", row);
    return undefined;
  }

  function block(parentIndent, style, chomp) {
    const parts = [];
    let width;
    while (cursor < rows.length) {
      const row = rows[cursor];
      if (row.content && row.indent <= parentIndent) break;
      if (row.content && width === undefined) width = row.indent;
      if (row.content && row.indent < width) { flag("invalid-yaml", row); break; }
      parts.push(row.content ? row.text.slice(width) : "");
      cursor++;
    }
    let value = "";
    for (let n = 0; n < parts.length; n++) {
      const here = parts[n], after = parts[n + 1];
      value += here;
      if (style === ">" && here && after && !/^\s/.test(here) && !/^\s/.test(after)) value += " ";
      else if (style === ">" && here && after === "") continue;
      else value += "\n";
    }
    if (chomp === "+") return value;
    let end = value.length;
    while (end && value[end - 1] === "\n") end--;
    return value.slice(0, end) + (chomp !== "-" && end ? "\n" : "");
  }

  function skipChildren(indent) {
    while (next() && rows[cursor].indent > indent) cursor++;
  }
  function readValue(raw, indent, row, depth, sequenceItem = false) {
    const style = /^([|>])([+-]?)(?:\s+#.*)?\s*$/.exec(raw);
    if (style) return block(indent, style[1], style[2]);
    const child = next();
    if (!raw || raw.startsWith("#")) {
      if (!child || child.indent < indent || (child.indent === indent && (sequenceItem || !isItem(child.content)))) return "";
      if (isItem(child.content) || keyPattern.test(child.content)) return collection(child.indent, depth + 1, child.indent === indent);
      cursor++;
      return readValue(child.content, indent, child, depth);
    }
    const initial = raw && !raw.startsWith("#") ? inline(raw, row) : "";
    if (!child || child.indent <= indent) return initial;
    if (typeof initial !== "string" || /^["']/.test(raw)) {
      if (initial !== undefined) flag("unverified-yaml", child);
      skipChildren(indent);
      return initial;
    }
    const chunks = [initial];
    let lastLine = row.line;
    while (next() && rows[cursor].indent > indent) {
      const continuation = rows[cursor++];
      const value = plain(continuation.content, continuation);
      const blankLines = continuation.line - lastLine - 1;
      chunks.push(blankLines ? "\n".repeat(blankLines) : " ");
      chunks.push(value);
      lastLine = continuation.line;
    }
    return chunks.join("");
  }
  function property(target, content, indent, row, depth) {
    const match = keyPattern.exec(content);
    if (!match) {
      if (depth === 0) unknownKeys = true;
      // Quoted/complex keys and explicit collection syntax can be valid YAML.
      flag(/^(?:['"?!&*%[{]|---(?:\s|$)|\.\.\.(?:\s|$))/.test(content) || /:(?:\s|$)/.test(content) ? "unverified-yaml" : "invalid-yaml", row);
      skipChildren(indent);
      return;
    }
    const key = match[2] || match[3];
    const raw = match[4] || "";
    if (Object.hasOwn(positions.get(target), key)) flag("invalid-yaml", row);
    positions.get(target)[key] = row.line;
    const value = readValue(raw, indent, row, depth);
    if (value === undefined && depth === 0) unknownFields.add(key);
    if (value !== undefined) target[key] = value;
  }
  function collection(indent, depth, indentationless = false) {
    if (depth > 64) {
      flag("unverified-yaml", rows[cursor]);
      skipChildren(indent - 1);
      return undefined;
    }
    const sequence = isItem(rows[cursor].content);
    const target = sequence ? [] : map();
    if (sequence) positions.set(target, []);
    while (next() && rows[cursor].indent >= indent) {
      if (indentationless && rows[cursor].indent === indent && !isItem(rows[cursor].content)) break;
      const row = rows[cursor++];
      if (row.indent !== indent || isItem(row.content) !== sequence) { flag("invalid-yaml", row); continue; }
      if (!sequence) { property(target, row.content, indent, row, depth); continue; }
      positions.get(target).push(row.line);
      const tail = row.content.slice(1).trimStart();
      if (keyPattern.test(tail)) {
        const entry = map();
        const keyIndent = indent + row.content.length - tail.length;
        property(entry, tail, keyIndent, row, depth);
        while (next() && rows[cursor].indent > indent) {
          const field = rows[cursor++];
          if (field.indent !== keyIndent) { flag("invalid-yaml", field); continue; }
          property(entry, field.content, keyIndent, field, depth);
        }
        target.push(entry);
      } else target.push(readValue(tail, indent, row, depth, true));
    }
    return target;
  }
  const root = next();
  let value = root ? collection(root.indent, 0) : map();
  if (next()) flag("invalid-yaml", rows[cursor]);
  if (Array.isArray(value)) { flag("unverified-yaml", root); unknownKeys = true; value = map(); }
  return { value, issue, unknownFields, unknownKeys, positions, lines: positions.get(value) };
}

function parseFrontmatter(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const opening = /^---\r?\n/.exec(text);
  if (!opening) return { ok: false, error: "SKILL.md must begin with YAML frontmatter", fm: {}, body: text, front: "" };
  const end = /^---[ \t]*\r?$/gm;
  end.lastIndex = opening[0].length;
  const closing = end.exec(text);
  if (!closing) return { ok: false, error: "YAML frontmatter is not closed with ---", fm: {}, body: text, front: "" };
  const front = text.slice(opening[0].length, closing.index).replace(/\r?\n$/, "");
  const parsed = readYaml(front, 2);
  return { ok: !parsed.issue, fm: parsed.value, lines: parsed.lines, issue: parsed.issue,
    unknownFields: parsed.unknownFields, unknownKeys: parsed.unknownKeys,
    body: text.slice(end.lastIndex).replace(/^\n/, ""), front };
}

function yamlFinding(issue, file) {
  const invalid = issue.code === "invalid-yaml";
  const subject = file === "SKILL.md" ? "frontmatter" : file;
  return finding(file === "SKILL.md" ? "structure" : "codex", invalid ? "error" : "review", issue.code,
    subject + (invalid ? " is not valid YAML" : " could not be verified"), file, issue.line,
    invalid ? "Correct the YAML at the indicated line." : "Verify this YAML with a full parser.");
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
      // A candidate without a guide uses the same discovery boundary on this second walk.
      if (discoveryDepth !== Infinity && entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) continue;
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
  return sharedWordScore(aa, bb);
}

function sharedWordScore(aa, bb) {
  if (!aa.size || !bb.size) return 0;
  let both = 0;
  for (const token of aa) if (bb.has(token)) both++;
  return both / Math.min(aa.size, bb.size);
}

const EVERYDAY_WORDS = new Set(("a an and are as at be before by can do does for from had has have how if in into is it " +
  "not of on or other our per that the their them then there these they this those to use used uses using was we when " +
  "whenever where which who will with without would you your ask asks asked request requested skill skills user users agent agents").split(" "));

function closestDescriptions(skills) {
  const descriptions = skills.filter(skill => skill.description).map(({ name, description }) => {
    const words = description.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
    return { name, words: new Set(words.filter(word => !EVERYDAY_WORDS.has(word))) };
  }).sort((a, b) => comparePath(a.name, b.name));
  const best = [];
  function order(a, b) {
    return b.score - a.score || comparePath(a.names[0], b.names[0]) || comparePath(a.names[1], b.names[1]);
  }
  for (let i = 0; i < descriptions.length; i++) {
    const a = descriptions[i];
    for (let j = i + 1; j < descriptions.length; j++) {
      const b = descriptions[j];
      if (a.name === b.name) continue;
      const pair = { names: [a.name, b.name], score: sharedWordScore(a.words, b.words) };
      if (best.length === 5 && order(pair, best[4]) >= 0) continue;
      const previous = best.findIndex(item => item.names[0] === a.name && item.names[1] === b.name);
      if (previous >= 0) {
        if (best[previous].score >= pair.score) continue;
        best.splice(previous, 1);
      }
      best.push(pair);
      best.sort(order);
      if (best.length > 5) best.pop();
    }
  }
  return best;
}

function escapedMarkdown(text, at) {
  let start = at;
  while (start > 0 && text[start - 1] === "\\") start--;
  return (at - start) % 2 === 1;
}

// Match equal-length backtick runs within a paragraph. Index each run once so an
// unmatched opening tick cannot hide later links or force repeated forward scans.
function inlineCodeLookup(lines) {
  const starts = [], spans = [], runs = [], previous = new Map();
  let offset = 0;
  function finishParagraph() {
    for (let i = 0; i < runs.length; i++) {
      const open = runs[i];
      if (open.escaped || open.next === undefined) continue;
      const close = runs[open.next];
      spans.push([open.at, close.at + close.width]);
      i = open.next;
    }
    runs.length = 0;
    previous.clear();
  }
  for (const line of lines) {
    starts.push(offset);
    if (!line.trim() || /^ {0,3}(?:`{3,}|~{3,})/.test(line)) {
      finishParagraph();
    } else {
      for (const match of line.matchAll(/`+/g)) {
        const width = match[0].length;
        const prior = previous.get(width);
        if (prior) prior.next = runs.length;
        const run = { at: offset + match.index, width, escaped: escapedMarkdown(line, match.index) };
        previous.set(width, run);
        runs.push(run);
      }
    }
    offset += line.length + 1;
  }
  finishParagraph();
  let index = 0;
  return (line, column) => {
    const at = starts[line] + column;
    while (index < spans.length && spans[index][1] <= at) index++;
    if (index === spans.length || at < spans[index][0]) return "";
    return at === spans[index][0] ? "opening" : "inside";
  };
}

// Markdown destinations use the containing document. Instruction paths beginning with a
// bundled folder or the skill-directory variable use the skill's installation directory.
const markdownFile = name => /\.(?:md|markdown)$/i.test(name);

function referencesIn(file, bundleFolders) {
  const refs = new Map();
  const yaml = file.rel === "agents/openai.yaml";
  if (!yaml && !markdownFile(file.rel)) return refs.values();
  const entryDocument = yaml || file.rel === "SKILL.md";
  const variable = "${CLAUDE_SKILL_DIR}/";
  let fence = "";
  let shell = false;
  const lines = file.text.split(/\r?\n/);
  const inCode = inlineCodeLookup(lines);
  let resumeLine = -1, resumeColumn = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i < resumeLine) continue;
    const continuation = i === resumeLine;
    const line = lines[i];
    const delimiter = !continuation && !yaml && line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) {
        fence = delimiter[1];
        shell = /^\s*(?:bash|sh|shell|zsh|fish|console)\s*$/i.test(line.slice(delimiter[0].length));
      } else if (delimiter[1].startsWith(fence)) fence = "";
      continue;
    }
    if (fence && !shell) continue;

    function add(raw, kind, instruction = false) {
      const link = kind !== "text";
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
      const conventional = entryDocument && /^(?:\.\/)?(?:scripts|references|assets)\/.+/.test(target);
      const explicit = anchored || target.startsWith("./") || bundled || conventional;
      // Filenames mentioned as examples or source-tree conventions do not direct the
      // reader to open them. Ambiguous file operands in instructions still get reviewed.
      const fileLike = /(?:^|\/)[^./\s][^/]*\.[a-z\d]{1,12}$/i.test(target);
      const operand = instruction && (absolute ? !target.endsWith("/") : fileLike);
      if (!link && !(explicit && !target.endsWith("/")) && !operand) return;
      const base = yaml || anchored || (!link && bundled) ? "." : path.posix.dirname(file.rel);
      const tryRoot = !link && !absolute && base !== "." && target.startsWith("./");
      const certain = conventional || (entryDocument && kind === "markdown");
      const parts = target.replace(/^(?:\.\/)+/, "").split("/");
      const bundlePath = parts.length > 1 && (bundleFolders.has(parts[0]) || ["scripts", "references", "assets"].includes(parts[0]));
      const leavesSkill = !absolute && path.posix.join(base, target).startsWith("../");
      const reviewable = kind === "markdown" || kind === "html" || anchored || bundlePath || leavesSkill;
      const ref = { value, target, base, absolute, tryRoot, certain, reviewable, kind, line: i + 1 };
      const identity = JSON.stringify([ref.line, base, target]);
      const prior = refs.get(identity);
      if (!prior || ref.certain || (!prior.certain && ref.reviewable && !prior.reviewable)) refs.set(identity, ref);
    }

    // Consume a whole link (including its label and title) once. Recognize balanced
    // parentheses in unquoted destinations, and spaces in angle-bracket destinations.
    function linkKind(column, syntax = "markdown") {
      const indented = !continuation && !yaml && /^(?: {4}|\t)/.test(line);
      return fence || indented || escapedMarkdown(line, column) || inCode(i, column) ? "example" : syntax;
    }
    const destination = /^(?:<([^>]+)>|((?:\\.|[^()\s\\]|\((?:\\.|[^()\\])*\))+))/;
    const definition = !continuation && !yaml && line.match(/^\s{0,3}\[[^\]]+\]:\s*(.*)$/);
    if (definition) {
      const match = definition[1].match(destination);
      if (match) add(match[1] || match[2], linkKind(line.indexOf("[")));
      continue;
    }
    const token = /`([^`]+)`|\[([^\[\]]*)\]\(\s*|(?:^|[\s'"(=])((?:\$\{CLAUDE_SKILL_DIR\}\/|\.\.?\/|\/|[\p{L}\p{M}\p{N}_@+.~-]+\/)[^\s'"`\])]+|[\p{L}\p{M}\p{N}_@+~-]+(?:\.[\p{L}\p{M}\p{N}_@+-]+)+)|<(img|a)\b((?:"[^"]*"|'[^']*'|[^'"<>])*)>/giu;
    let match;
    if (continuation) token.lastIndex = resumeColumn;
    const firstWord = line.search(/\S/);
    while ((match = token.exec(line))) {
      const prefix = line.slice(Math.max(0, match.index - 100), match.index);
      const instruction = yaml || match.index <= firstWord || /(?:^|[.!?:;>,–—-]|\b(?:and|or|then|please|to|can|should|must))\s*(?:read|run|open|use|load|see|consult|include|execute|source|check|refer to)(?:\s+(?:the|a|this|file|script|guide|document|in|at|from)){0,4}\s*:?\s*$/i.test(prefix);
      if (match[4] !== undefined) {
        if (fence) continue;
        const wanted = match[4].toLowerCase() === "img" ? "src" : "href";
        const attributes = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
        for (const attr of match[5].matchAll(attributes)) {
          if (attr[1].toLowerCase() === wanted) add(attr[2] || attr[3] || attr[4] || "", linkKind(match.index, "html"));
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
        add((dest[1] || dest[2]).replace(/\\([()])/g, "$1"), linkKind(match.index));
        if (lastLine === i) token.lastIndex = endOffset + end[0].length;
        else {
          resumeLine = lastLine;
          resumeColumn = endOffset + end[0].length;
          break;
        }
      } else if (match[1] !== undefined) {
        // A closing tick from a multiline span can precede another inline span.
        if (inCode(i, match.index) !== "opening") {
          token.lastIndex = match.index + 1;
          continue;
        }
        // A code span can contain either a single path (including spaces) or a command.
        const span = match[1];
        const words = Array.from(span.matchAll(/"([^"]+)"|'([^']+)'|([^\s]+)/g), w => w[1] || w[2] || w[3]);
        const first = words[0] || "";
        const isCommand = words.length > 1 && (!first.includes("/") || /\.[\w-]+$/.test(first) ||
          words.some(word => /^--?\w/.test(word)) || !/\.[\w-]+$/.test(span));
        if (isCommand) {
          for (let w = 0; w < words.length; w++) {
            if (["--output", "--output-dir", "-o"].includes(words[w - 1])) continue;
            if (!words[w].startsWith("-") && words[w].includes("/")) add(words[w], "text", instruction);
          }
        } else add(span, "text", instruction);
      } else if (!/(?:^|\s)(?:--output(?:-dir)?|-o)\s*=?\s*$/.test(prefix)) {
        add(match[3], "text", instruction);
      }
    }
  }
  return refs.values();
}

const SCRIPT_LANGUAGES = new Map([
  [".sh", "shell"], [".bash", "shell"], [".zsh", "shell"], [".ps1", "powershell"],
  [".js", "node"], [".cjs", "node"], [".mjs", "node"], [".ts", "node"], [".py", "python"],
]);

function personalPath(file) {
  const ext = path.extname(file.rel).toLowerCase();
  if (ext !== ".md" && file.rel !== "agents/openai.yaml" && !SCRIPT_LANGUAGES.has(ext)) return;
  // Consume a whole web URL before looking for local paths in its segments.
  const pattern = /\b(?:https?|ftp):\/\/[^\s<>"'`\])]+|(?<![\w./~\\-])(?:file:\/\/)?((?:\/Users\/|\/home\/|[a-z]:[\\/]Users[\\/])([\p{L}\p{N}._-]+)|\/root(?=$|[\/\s'"`),;:\]])|\x25USERPROFILE%)/giu;
  for (const match of file.text.matchAll(pattern)) {
    if (!match[1] || /^(?:username|yourname|your-name|your_name)$/i.test(match[2])) continue;
    if (/^\/Users\/Shared$/i.test(match[1])) continue;
    return { text: match[1], line: file.text.slice(0, match.index).split("\n").length };
  }
}

function* commandSources(file) {
  const ext = path.extname(file.rel).toLowerCase();
  const language = SCRIPT_LANGUAGES.get(ext);
  if (language) {
    yield { language, text: file.text, line: 1 };
  } else if (ext === ".md") {
    let fence, block, start;
    const lines = file.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
      if (!fence && delimiter) {
        fence = delimiter[1];
        start = i + 2;
        const info = delimiter[2].trim().split(/\s+/)[0].toLowerCase();
        const language = /^(?:bash|sh|shell|zsh|fish|console)$/.test(info) ? "shell"
          : /^(?:powershell|pwsh|ps1)$/.test(info) ? "powershell" : "";
        block = language && { language, lines: [] };
      } else if (fence && delimiter && delimiter[1].startsWith(fence) && !delimiter[2].trim()) {
        if (block) yield { language: block.language, text: block.lines.join("\n"), line: start };
        fence = null;
      } else if (fence && block) block.lines.push(lines[i]);
    }
    if (fence && block) yield { language: block.language, text: block.lines.join("\n"), line: start };
  }
}

// Keep line breaks and offsets when removing strings and comments. The module marker
// lets the import checks distinguish built-in process functions from unrelated APIs.
function maskedCode(text, language) {
  const ignored = language === "python"
    ? /#[^\n]*|'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?/g
    : /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?/g;
  return text.replace(ignored, token => {
    if (/^(['"])(?:node:)?child_process\1$/.test(token)) return "@builtin".padEnd(token.length);
    if (/^(['"])recursive\1$/.test(token)) return " recursive ";
    return token.replace(/[^\n]/g, " ");
  });
}

function processBindings(code) {
  const calls = new Set(), modules = new Set(["child_process"]);
  const builtins = /^(?:exec(?:Sync|File(?:Sync)?)?|spawn(?:Sync)?|fork)$/;
  for (const match of code.matchAll(/(?:\bimport\s+\{([^{}]*)\}\s+from\s+@builtin|\{([^{}]*)\}\s*=\s*require\s*\(\s*@builtin\s*\))/g)) {
    for (const entry of (match[1] || match[2] || "").split(",")) {
      const names = entry.trim().split(/\s*(?::|\bas\b)\s*/);
      if (builtins.test(names[0])) calls.add(names[1] || names[0]);
    }
  }
  for (const match of code.matchAll(/(?:\bimport\s+(?:\*\s+as\s+)?([\w$]+)\s+from\s+@builtin|\b([\w$]+)\s*=\s*require\s*\(\s*@builtin\s*\))/g)) {
    modules.add(match[1] || match[2]);
  }
  for (const match of code.matchAll(/\b([\w$]+)(?:\s*\.\s*([\w$]+))?\s*\(/g)) {
    if (match[2] ? modules.has(match[1]) && builtins.test(match[2]) : calls.has(match[1])) return match;
  }
  return /\brequire\s*\(\s*@builtin\s*\)\s*\.\s*(?:exec(?:Sync|File(?:Sync)?)?|spawn(?:Sync)?|fork)\s*\(/.exec(code);
}

function recursiveFileRemoval(code) {
  const parentheses = [];
  let currentRemoval;
  for (const match of code.matchAll(/\bfs\s*\.\s*rm(?:Sync)?\s*\(|\brecursive\s*:\s*true\b|[()]/g)) {
    if (match[0].endsWith("(")) {
      parentheses.push(currentRemoval);
      if (match[0] !== "(") currentRemoval = match;
    } else if (match[0] === ")") currentRemoval = parentheses.pop();
    else if (currentRemoval) return currentRemoval;
  }
}

function inspectProgram(source, record) {
  const code = maskedCode(source.text, source.language);
  function add(rule, match) {
    if (!match) return;
    const evidence = source.text.slice(match.index, match.index + match[0].length);
    record(rule, evidence, source.line + code.slice(0, match.index).split("\n").length - 1);
  }
  if (source.language === "python") {
    add("destructive", /\bshutil\s*\.\s*rmtree\s*\(/.exec(code));
    add("execution", /\b(?:subprocess\s*\.\s*(?:run|Popen|call|check_call|check_output|getoutput|getstatusoutput)|os\s*\.\s*system|eval)\s*\(/.exec(code));
    add("network", /\b(?:requests\s*\.\s*(?:get|post|put|delete|patch|head|options|request)|urllib\s*\.\s*request\s*\.\s*(?:urlopen|urlretrieve))\s*\(/.exec(code));
  } else {
    add("destructive", recursiveFileRemoval(code));
    add("execution", processBindings(code) || /\beval\s*\(/.exec(code));
    add("network", /\b(?:fetch|https?\s*\.\s*(?:get|request))\s*\(/.exec(code));
  }
}

function inspectShell(source, record) {
  // Split commands at unquoted operators. Quoted command names and flags are words.
  const tokens = /\\\r?\n|(?:[^\s;&|()'"\\#]|\\[^\n]|"(?:\\.|[^"\\])*"?|'[^']*'?)+|#[^\n]*|&&|\|\||[;&|()\n]/g;
  let words = [], pipeFromDownload = false, line = source.line, commandLine = line;
  function endCommand(separator) {
    let start = 0;
    while (start < words.length) {
      const word = words[start].value;
      if (word === "sudo") {
        start++;
        while (start < words.length && words[start].value.startsWith("-")) {
          const flag = words[start++].value;
          if (/^-(?:u|g|h|p|C|T)$/.test(flag)) start++;
        }
      } else if (/^(?:if|elif|then|else|do|command|env|\$)$/.test(word) || /^\w+=/.test(word)) start++;
      else break;
    }
    if (start >= words.length) {
      if (separator !== "\n") pipeFromDownload = false;
    } else {
      const name = words[start].value.split(/[\\/]/).pop().toLowerCase();
      const params = words.slice(start + 1);
      const args = params.map(w => w.value);
      const delimiter = args.indexOf("--");
      const options = delimiter < 0 ? args : args.slice(0, delimiter);
      const flags = options.filter(a => /^-[^-]/.test(a)).join("");
      const helpOnly = args.length === 1 && ["--help", "--version", "-V"].includes(args[0]);
      const download = ["curl", "wget", "invoke-webrequest"].includes(name) && !helpOnly;
      const installs = (name === "npm" && /^(?:install|i|ci)$/.test(args.find(a => !a.startsWith("-")))) ||
        (name === "npx" && args.some(a => !a.startsWith("-"))) ||
        (/^pip(?:3(?:\.\d+)?)?$/.test(name) && args.includes("install")) ||
        (/^python(?:3(?:\.\d+)?)?$/.test(name) && args.join(" ").includes("-m pip install"));
      if (download || installs) record("network", words[start].value, commandLine);
      if (pipeFromDownload && /^(?:sh|bash|zsh|dash|ksh|pwsh|powershell)$/.test(name)) record("execution", words[start].value, commandLine);
      if ((name === "rm" && (/[rR]/.test(flags) || options.includes("--recursive")) && (flags.includes("f") || options.includes("--force"))) ||
          (name === "find" && args.includes("-delete")) ||
          (name === "git" && ((args[0] === "reset" && args.includes("--hard")) || (args[0] === "push" && args.includes("--force")))) ||
          (name === "dd" && args.some(a => a.startsWith("if="))) ||
          (name === "remove-item" && params.some(w => /^-recurse$/i.test(w.raw)))) {
        record("destructive", words[start].value, commandLine);
      }
      pipeFromDownload = separator === "|" && download;
    }
    words = [];
  }
  for (const match of source.text.matchAll(tokens)) {
    const token = match[0];
    if (/^(?:&&|\|\||[;&|()\n])$/.test(token)) endCommand(token);
    else if (!token.startsWith("#") && !/^\\\r?\n$/.test(token)) {
      if (!words.length) commandLine = line;
      words.push({ raw: token, value: token.replace(/(['"])(.*?)\1/g, "$2") });
    }
    line += token.split("\n").length - 1;
  }
  endCommand("");
}

function contentSafety(file) {
  const found = {};
  function record(rule, text, line) {
    if (!found[rule]) found[rule] = { text, line };
  }
  for (const source of commandSources(file)) {
    if (source.language === "shell" || source.language === "powershell") inspectShell(source, record);
    else inspectProgram(source, record);
  }
  return found;
}

function referenceInspector(skillDir) {
  // Cache only directory entries. Each segment must match case, even on a volume
  // where asking the OS for a wrong-case path would succeed.
  const directories = new Map();
  const unknown = { state: "unknown" };
  const missing = { state: "missing" };
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
      if (!path.isAbsolute(target) || !inside(skillDir, target)) return unknown;
      target = path.relative(skillDir, target).split(path.sep).join("/");
      start = skillDir;
    }
    if (!inside(skillDir, path.resolve(start, target))) return unknown;
    let parts = target.split("/");
    let links = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part === ".") continue;
      if (part === "..") {
        start = path.dirname(start);
        if (!inside(skillDir, start)) return unknown;
        continue;
      }
      const names = entries(start);
      if (!names) return unknown;
      const entry = names.get(part);
      if (!entry) return missing;
      const current = path.join(start, part);
      if (entry.isSymbolicLink()) {
        if (++links > 40) return unknown;
        let link;
        try { link = fs.readlinkSync(current); } catch { return unknown; }
        if (!inside(skillDir, path.resolve(start, link))) return unknown;
        if (path.isAbsolute(link)) { link = path.relative(skillDir, link); start = skillDir; }
        parts = [...link.split(path.sep), ...parts.slice(i + 1)];
        i = -1;
      } else {
        if (i + 1 < parts.length && !entry.isDirectory()) return missing;
        if (!entry.isFile() && !entry.isDirectory()) return unknown;
        if (i + 1 < parts.length && part === ".git") return unknown;
        start = current;
      }
    }
    return { state: "present", relative: path.relative(skillDir, start).split(path.sep).join("/") };
  }
  return { bundleFolders, inspect };
}

function needsContents(text) {
  const lines = text.split(/\r?\n/, 102);
  if (lines.length <= 100 || (lines.length === 101 && lines[100] === "")) return false;
  const label = /^(?:contents|table of contents|toc|on this page|in this file):?$/i;
  let fence = "";
  for (let i = 0; i < 30; i++) {
    const line = lines[i];
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1].startsWith(fence) && !delimiter[2].trim()) fence = "";
      continue;
    }
    if (fence) continue;
    const atx = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    const bold = /^ {0,3}(\*\*|__)(.+?)\1:?[ \t]*$/.exec(line);
    if (atx && label.test(atx[1]) || bold && label.test(bold[2])) return false;
    if (i < 29 && label.test(line.trim()) && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[i + 1])) return false;
  }
  return true;
}

function indirectReferences(links) {
  const direct = links.get("SKILL.md") || new Set();
  const reachable = new Set(["SKILL.md", ...direct]);
  // Set iteration visits newly added destinations once, even in a cycle.
  for (const file of reachable) {
    for (const target of links.get(file) || []) reachable.add(target);
  }
  return [...reachable].filter(file => file !== "SKILL.md" && !direct.has(file)).sort(comparePath);
}

const SHARED_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const CLAUDE_FIELDS = new Set([
  "when_to_use", "argument-hint", "arguments", "disable-model-invocation", "user-invocable",
  "disallowed-tools", "model", "effort", "context", "agent", "background", "hooks", "paths", "shell",
]);

function checkFrontmatterFields(parsed, description, findings) {
  const { fm, lines } = parsed;
  if (Object.hasOwn(lines, "allowed-tools")) {
    findings.push(finding("portability", "review", "allowed-tools-extension",
      "The Agent Skills specification marks allowed-tools as experimental", "SKILL.md", lines["allowed-tools"],
      "Document the dependency and provide a portable fallback."));
  }
  const extraFields = Object.keys(lines).filter(key => !SHARED_FIELDS.has(key)).sort((a, b) => lines[a] - lines[b]);
  if (extraFields.length) {
    const labels = extraFields.map(key => key + (CLAUDE_FIELDS.has(key) ? " (Claude Code)" : " (product unconfirmed)"));
    findings.push(finding("portability", "review", "extra-frontmatter-fields",
      "Fields outside the Agent Skills specification: " + labels.join(", "), "SKILL.md", lines[extraFields[0]],
      "Document which product reads these fields and how to use the skill on other agents."));
  }
  if (typeof fm.compatibility === "string" && Array.from(fm.compatibility).length > 500) {
    findings.push(finding("structure", "error", "compatibility-too-long", "Compatibility exceeds the 500-character limit",
      "SKILL.md", lines.compatibility, "Shorten compatibility to 500 characters or fewer."));
  }
  if (typeof fm.name === "string" && /[<>]/.test(fm.name)) {
    findings.push(finding("claude", "review", "claude-name-angle-bracket",
      "Claude uploads reject angle brackets in the name. Claude Code rejects this frontmatter name. The skill can still load under a valid folder name.",
      "SKILL.md", lines.name, "Use a lowercase hyphenated name matching the skill folder."));
  }
  if (/[<>]/.test(description)) {
    findings.push(finding("claude", "review", "claude-description-angle-bracket",
      "Claude uploads reject angle brackets in the description. Claude Code accepts them and displays &lt; and &gt;.",
      "SKILL.md", lines.description, "Use square brackets or plain text in the description."));
  }
}

// Exact capability identifiers. Common verbs such as Read and Stop also occur
// in ordinary instructions, so they cannot identify a product from prose.
const CLAUDE_CAPABILITIES = [
  "AskUserQuestion", "CronCreate", "CronDelete", "CronList", "EndConversation", "EnterPlanMode",
  "EnterWorktree", "ExitPlanMode", "ExitWorktree", "ListAgents", "ListMcpResourcesTool",
  "ListPlugins", "ListSkills", "NotebookEdit", "propose_skills", "PushNotification",
  "ReadMcpResourceTool", "RemoteTrigger", "ReportFindings", "ScheduleWakeup", "SearchPlugins",
  "SearchSkills", "SendFeedback", "SendMessage", "SendUserFile", "ShareOnboardingGuide",
  "SubagentHandback", "SuggestPluginInstall", "SuggestSkills", "TaskCreate", "TaskGet",
  "TaskList", "TaskOutput", "TaskStop", "TaskUpdate", "TodoWrite", "ToolSearch", "WaitForMcpServers",
  "WebFetch", "UserPromptExpansion", "PreSkillShellCommand", "PermissionDenied", "PostToolBatch",
  "PostToolUseFailure", "MessageDisplay", "TaskCreated", "TaskCompleted", "StopFailure",
  "TeammateIdle", "InstructionsLoaded", "ConfigChange", "CwdChanged", "DirectoryAdded",
  "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreModelSwitch", "PostModelSwitch", "ElicitationResult",
];
const CODEX_CAPABILITIES = [
  "request_user_input", "apply_patch", "exec_command", "write_stdin", "update_plan",
  "spawn_agent", "send_input", "send_message", "followup_task", "resume_agent", "wait_agent",
  "list_agents", "close_agent", "interrupt_agent", "PreModelRequest", "PostModelRequest",
];
const SHARED_CAPABILITIES = [
  "PreToolUse", "PostToolUse", "PreCompact", "PostCompact", "PermissionRequest",
  "UserPromptSubmit", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "WebSearch",
];

function undeclaredCapabilities(compatibility) {
  const claude = /\bclaude\b/i.test(compatibility);
  const codex = /\bcodex\b/i.test(compatibility);
  if (claude && codex) return null;
  const names = [];
  if (!claude) names.push(...CLAUDE_CAPABILITIES);
  if (!codex) names.push(...CODEX_CAPABILITIES);
  if (!claude && !codex) names.push(...SHARED_CAPABILITIES);
  return new RegExp("\\b(?:" + names.join("|") + ")\\b");
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
  else if (skillFile && !parsed.ok && !parsed.issue) findings.push(finding("structure", "error", "malformed-frontmatter", parsed.error, "SKILL.md", 1, "Repair the opening YAML frontmatter and its closing delimiter."));

  if (parsed.issue) findings.push(yamlFinding(parsed.issue, "SKILL.md"));

  const fm = parsed.fm || {};
  const name = scalar(fm.name) || folder;
  const description = scalar(fm.description);
  const raw = skillFile ? skillFile.text : "";
  if (parsed.ok || parsed.issue?.code === "unverified-yaml") {
    if (!scalar(fm.name) && !parsed.unknownKeys && !parsed.unknownFields.has("name")) findings.push(finding("structure", "error", "missing-name", "Frontmatter is missing name", "SKILL.md", 2, "Add a name matching the skill folder."));
    if (!description && !parsed.unknownKeys && !parsed.unknownFields.has("description")) findings.push(finding("structure", "error", "missing-description", "Frontmatter is missing description", "SKILL.md", 2, "Describe what the skill does and when it should trigger."));
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

    if (/(?:^|-)(?:anthropic|claude)(?:-|$)/i.test(name)) findings.push(finding("claude", "error", "claude-reserved-name", "Claude reserves 'anthropic' and 'claude' in custom skill names", "SKILL.md", lineOf(raw, "name:"), "Choose a model-neutral name."));
    checkFrontmatterFields(parsed, description, findings);
  }

  const capabilities = undeclaredCapabilities(scalar(fm.compatibility));
  const inspector = referenceInspector(dirReal);
  const readableFiles = collected.files.filter(f => !f.binary && !f.skipped);
  const links = new Map(readableFiles.filter(f => markdownFile(f.rel)).map(f => [f.rel, new Set()]));
  for (const file of readableFiles) {
    for (const ref of referencesIn(file, inspector.bundleFolders)) {
      let result = inspector.inspect(ref);
      if (ref.tryRoot && result.state !== "present") {
        const alternative = inspector.inspect({ ...ref, base: "." });
        if (result.state === "missing" || alternative.state === "present") result = alternative;
      }
      if (result.state === "present") {
        if (ref.kind !== "example" && links.has(result.relative)) links.get(file.rel)?.add(result.relative);
        continue;
      }
      // The .markdown extension participates in layout advice only.
      if (/\.markdown$/i.test(file.rel)) continue;
      if (result.state === "missing" && ref.certain) findings.push(finding("structure", "error", "broken-reference", `Referenced file does not exist: ${ref.value}`, file.rel, ref.line, "Add the file or correct the relative path."));
      else if (ref.reviewable) findings.push(finding("structure", "review", "unverified-reference", `Could not verify reference: ${ref.value}`, file.rel, ref.line, "Confirm the intended location before changing this reference."));
    }
    if (file.rel.startsWith("references/") && markdownFile(file.rel) && needsContents(file.text)) findings.push(finding("structure", "review", "reference-no-toc", `Long reference has no contents section: ${file.rel}`, file.rel, 1, "Add a short table of contents near the top."));

    const personal = personalPath(file);
    if (personal) findings.push(finding("portability", "review", "personal-path", `Machine- or workspace-specific path found: ${personal.text}`, file.rel, personal.line, "Parameterize the path or label the skill as workspace-specific."));
    if (capabilities && (file.rel === "SKILL.md" || file.rel === "agents/openai.yaml" ||
        (file.rel.startsWith("references/") && /\.(?:md|markdown)$/i.test(file.rel)))) {
      const match = capabilities.exec(file.text);
      if (match) findings.push(finding("portability", "review", "model-specific-tool", `Model-specific capability found: ${match[0]}`, file.rel, file.text.slice(0, match.index).split("\n").length, "Document the target agent and offer an equivalent fallback where practical."));
    }
    const { destructive, execution, network } = contentSafety(file);
    if (destructive) findings.push(finding("safety", "review", "destructive-command", "Potentially destructive command appears in skill content", file.rel, destructive.line, "Confirm it is defensive documentation; otherwise remove it or require explicit human approval."));
    if (execution) findings.push(finding("safety", "review", "code-execution", `Bundled code contains an execution primitive: ${execution.text}`, file.rel, execution.line, "Audit the call path and inputs manually; static inspection cannot prove it safe."));
    if (network) findings.push(finding("safety", "review", "network-access", `Potential network access found: ${network.text}`, file.rel, network.line, "Verify destinations, data exposure, and user approval requirements."));
  }

  for (const file of indirectReferences(links)) {
    findings.push(finding("structure", "review", "deep-reference", `Reference is reachable only through another reference: ${file}`, file, 1, "Keep references shallow so agents can discover them reliably."));
  }

  const openai = collected.files.find((f) => f.rel === "agents/openai.yaml" && !f.binary && !f.skipped);
  if (openai) {
    const config = readYaml(openai.text, 1);
    if (config.issue) findings.push(yamlFinding(config.issue, openai.rel));
    const doc = config.value;
    if (!config.issue) {
      const isMap = value => value !== null && typeof value === "object" && !Array.isArray(value);
      if (!isMap(doc.interface) && !isMap(doc.policy) && !isMap(doc.dependencies)) findings.push(finding("codex", "review", "openai-yaml-interface", "agents/openai.yaml has no interface block", openai.rel, 1, "Add interface metadata or remove the unused file."));
    }
    // Older configs also put the prompt or dependency list directly at the top.
    const promptMap = doc.interface?.default_prompt === undefined ? doc : doc.interface;
    if (typeof promptMap.default_prompt === "string" && promptMap.default_prompt && !promptMap.default_prompt.includes(`$${name}`)) findings.push(finding("codex", "review", "openai-default-prompt", "Codex default_prompt does not explicitly mention this skill", openai.rel, config.positions.get(promptMap).default_prompt, `Mention $${name} in the default prompt.`));
    if (Object.hasOwn(doc, "dependencies")) findings.push(finding("portability", "review", "declared-dependency", "Codex-specific tool dependencies are declared in agents/openai.yaml", openai.rel, config.lines.dependencies, "Verify every dependency is available and document a fallback for other agents."));
    const tools = Array.isArray(doc.dependencies) ? doc.dependencies : doc.dependencies?.tools;
    if (Array.isArray(tools)) {
      for (const [index, entry] of tools.entries()) {
        const type = entry?.type;
        if (type === "mcp") continue;
        const entryLine = config.positions.get(tools)[index];
        const fieldLines = config.positions.get(entry);
        if (type === undefined && fieldLines && Object.hasOwn(fieldLines, "type")) continue; // Already reported as unverified YAML.
        const label = !type ? "(missing)" : typeof type === "string" ? type : "(non-scalar)";
        findings.push(finding("codex", "review", "unsupported-dependency-type", `Unknown Codex dependency type: ${label}`, openai.rel, fieldLines?.type || entryLine, "Use a currently supported dependency type or remove the declaration."));
      }
    }
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
    _dirReal: dirReal,
  };
}

function finalizeStatus(skill) {
  const commonFail = skill.axes.structure === "fail";
  const workspace = skill.findings.some((f) => f.code === "personal-path");
  const safetyReview = skill.axes.safety !== "pass";
  if (commonFail) { skill.status = "Broken"; skill.statusKey = "broken"; }
  else if (safetyReview) { skill.status = "Needs review"; skill.statusKey = "review"; }
  else if (workspace) { skill.status = "Workspace-specific"; skill.statusKey = "workspace"; }
  else if (skill.axes.claude === "pass" && skill.axes.codex !== "pass") { skill.status = "Claude-ready"; skill.statusKey = "claude"; }
  else if (skill.axes.codex === "pass" && skill.axes.claude !== "pass") { skill.status = "Codex-ready"; skill.statusKey = "codex"; }
  else if (skill.findings.length) { skill.status = "Needs review"; skill.statusKey = "review"; }
  else { skill.status = "Universal"; skill.statusKey = "universal"; }
  const rank = { error: 0, review: 1, info: 2 };
  skill.findings.sort((a, b) => (rank[a.severity] - rank[b.severity]) || AXES.indexOf(a.axis) - AXES.indexOf(b.axis) || comparePath(a.file, b.file) || a.line - b.line);
  skill.counts = { errors: skill.findings.filter((f) => f.severity === "error").length, review: skill.findings.filter((f) => f.severity !== "error").length };
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
  return !name.startsWith(".") && name !== "node_modules";
}

function isFolder(entry, file) {
  if (!entry.isSymbolicLink()) return entry.isDirectory();
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

function discoverInstalls(context, add, links) {
  const { root, real, entries, report } = context;
  if (hasGuide(entries)) {
    add(context, root.path, real);
    return;
  }

  function recordHidden(dir) {
    (report.notSearched ||= []).push(path.relative(root.path, dir).split(path.sep).join("/"));
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
      if (entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) {
        if (isFolder(entry, path.join(realDir, entry.name))) recordHidden(path.join(dir, entry.name));
      } else if (!entry.isDirectory()) {
        result.populated = true;
      } else if (depth < 3 && discoveryDirectory(entry.name)) {
        search(path.join(dir, entry.name), path.join(realDir, entry.name), depth + 1, result);
      }
    }
  }

  for (const entry of entries) {
    const dir = path.join(root.path, entry.name);
    if (entry.name.startsWith(".")) {
      if (isFolder(entry, dir)) recordHidden(dir);
      continue;
    }
    if (!discoveryDirectory(entry.name)) continue;
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
  if (report.notSearched) report.notSearched.sort(comparePath);
}

function countSkillNames(folder, deadline) {
  let count = 0, partial = false;
  let rootReal;
  const pending = [folder];
  while (pending.length && Date.now() < deadline) {
    let directory;
    try {
      const current = pending.pop();
      if (current === folder) {
        rootReal = fs.realpathSync.native(folder);
      } else {
        // On Windows a junction can appear as an ordinary directory in a listing.
        if (fs.lstatSync(current).isSymbolicLink()) continue;
        const real = fs.realpathSync.native(current);
        const expected = path.join(rootReal, path.relative(folder, current));
        // Skip escapes as well as aliases to directories already inside this location.
        if (!inside(rootReal, real) || path.relative(expected, real) !== "") continue;
      }
      directory = fs.opendirSync(current);
      while (Date.now() < deadline) {
        const entry = directory.readSync();
        if (!entry) break;
        if (entry.isDirectory()) pending.push(path.join(directory.path, entry.name));
        else if (entry.isFile() && entry.name === "SKILL.md") count++;
      }
      if (Date.now() >= deadline) partial = true;
    } catch {
      partial = true;
    } finally {
      if (directory) directory.closeSync();
    }
  }
  return { count, partial: partial || pending.length > 0 };
}

function uncheckedLocations(contexts) {
  const deadline = Date.now() + 1600;
  const locations = new Map();
  const checkedRoots = new Set(contexts.map(context => context.real).filter(Boolean));
  function add(folder, kind) {
    if (locations.has(folder)) return;
    let entry;
    try {
      entry = fs.lstatSync(folder);
      if (!isFolder(entry, folder) || checkedRoots.has(fs.realpathSync(folder))) return;
    } catch { return; }
    // A linked directory is a visible location, but its target is outside this walk.
    const result = entry.isSymbolicLink() ? { count: 0, partial: true } : countSkillNames(folder, deadline);
    locations.set(folder, { path: displayPath(folder), kind, ...result });
  }
  for (const { root, entries } of contexts) {
    for (const entry of entries || []) {
      if (entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) {
        add(path.join(root.path, entry.name), "hidden");
      }
    }
  }
  add(path.join(os.homedir(), ".claude", "plugins"), "plugin");
  for (const name of [".claude", ".agents"]) add(path.join(process.cwd(), name, "skills"), "project");
  for (const name of [".gemini", ".cursor", ".copilot", ".config/opencode"]) add(path.join(os.homedir(), name, "skills"), "other-agent");
  return Array.from(locations.values()).sort((a, b) => comparePath(a.path, b.path));
}

function descriptionCharacters(skills, contexts) {
  const agentRoots = new Map(defaultRoots().map(root => [displayPath(root.path), root.id === "claude" ? "claude" : "codex"]));
  if (!contexts.some(context => agentRoots.has(context.report.path))) return;
  const totals = { claude: 0, codex: 0 };
  for (const skill of skills) {
    const length = Array.from(scalar(skill.frontmatter.name) + skill.description).length;
    const seen = new Set();
    for (const source of skill.sources) {
      const agent = agentRoots.get(source.root);
      if (agent && !seen.has(source.path)) {
        totals[agent] += length;
        seen.add(source.path);
      }
    }
  }
  return totals;
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
    status: "Needs review", statusKey: "review", _dirReal: "",
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
  for (const skill of unique) {
    finalizeStatus(skill);
    const worst = worstCopy.get(skill);
    if (worst && statusRank[worst.statusKey] < statusRank[skill.statusKey]) Object.assign(skill, worst);
  }
  unique.sort((a, b) => (statusRank[a.statusKey] - statusRank[b.statusKey]) || comparePath(a.name, b.name) || comparePath(a.digest, b.digest));
  const statuses = { universal: 0, claude: 0, codex: 0, workspace: 0, review: 0, broken: 0 };
  unique.forEach(skill => { statuses[skill.statusKey]++; });
  const summary = { skills: unique.length, mirrors, findings: unique.reduce((n, s) => n + s.findings.length, 0), statuses };
  const pairs = closestDescriptions(unique);
  if (pairs.length) summary.closestPairs = pairs;
  const characters = descriptionCharacters(unique, contexts);
  if (characters) summary.descriptionCharacters = characters;
  return {
    schemaVersion: 1,
    checkerVersion: CHECKER_VERSION,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    disclaimer: "Static contract evidence only — no scripts executed, no network used, and no runtime behavior guaranteed.",
    roots: contexts.map(context => context.report),
    ...(!options.roots?.length ? { coverage: uncheckedLocations(contexts) } : {}),
    summary,
    skills: unique,
  };
}

function parseCli(argv) {
  const roots = [];
  let json = false, includeBody = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--include-body") includeBody = true;
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
  return { roots, json, includeBody };
}

function compactSkill({ body, frontmatter, ...skill }) {
  return {
    ...skill,
    bodyBytes: Buffer.byteLength(body),
    frontmatterBytes: Buffer.byteLength(JSON.stringify(frontmatter)),
  };
}

// Escape individual output lines before adding the renderer's own line breaks.
function terminalText(text) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/g,
    ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

function printFindings(findings) {
  const groups = new Map();
  for (const item of findings) {
    if (!groups.has(item.code)) groups.set(item.code, { first: item, count: 0, suggestions: new Set() });
    const group = groups.get(item.code);
    group.count++;
    group.suggestions.add(item.suggestion);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    Number(b.first.axis === "safety") - Number(a.first.axis === "safety"));
  let omitted = 0;
  for (const [index, { first, count, suggestions }] of ordered.entries()) {
    if (index >= 8 && first.axis !== "safety") {
      omitted += count;
      continue;
    }
    const level = first.severity === "error" ? "ERROR" : "REVIEW";
    const repeat = count > 1 ? ` ×${count}` : "";
    console.log(terminalText(`  ${level} ${first.axis} · ${first.file}:${first.line} · ${first.message}${repeat} · ${[...suggestions].join(" ")}`));
  }
  if (omitted) console.log(`  … ${omitted} ${omitted === 1 ? "finding" : "findings"} not shown`);
}

function printHuman(report, explicitRoots) {
  for (const root of report.roots) {
    if (explicitRoots || root.state !== "missing") {
      console.log(terminalText(`${root.label} (${root.path}) — ${root.state}`));
      if (root.notSearched) console.log(terminalText(`  not searched: ${root.notSearched.join(", ")}`));
    }
  }
  if (report.coverage?.length) {
    console.log("Not checked");
    for (const entry of report.coverage) {
      console.log(terminalText(`  ${entry.path} (${entry.kind}): ${entry.count} SKILL.md${entry.partial ? " (partial count)" : ""}`));
    }
  }
  const s = report.summary.statuses;
  console.log(`Skill Doctor — ${report.summary.skills} unique skills (${report.summary.mirrors} identical mirrors)`);
  console.log(`Universal ${s.universal} · Claude-ready ${s.claude} · Codex-ready ${s.codex} · Workspace-specific ${s.workspace} · Needs review ${s.review} · Broken ${s.broken}`);
  console.log(report.disclaimer);
  const characters = report.summary.descriptionCharacters;
  if (characters) console.log(`Description characters — Claude ${characters.claude} (1% of context window estimate) · Codex ${characters.codex} (2% of context window, 8,000 characters when unknown, estimate)`);
  if (report.summary.closestPairs) {
    console.log("Closest descriptions");
    for (const { names, score } of report.summary.closestPairs) {
      console.log(terminalText(`  ${names[0]} / ${names[1]} — ${(score * 100).toFixed(1)}%`));
    }
  }
  for (const skill of report.skills) {
    console.log("");
    console.log(terminalText(`${skill.status.padEnd(18)} ${skill.name}  [${skill.sources.map(source => source.isLink ? source.label + " (link)" : source.label).join(", ")}]`));
    printFindings(skill.findings);
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
      console.log("Usage: node scripts/audit-skills.js [--json [--include-body]] [--root label=/absolute/path]...");
      console.log("Exit 0: completed without Broken skills or open command safety findings. Help and version also exit 0.");
      console.log("Exit 2: a Broken skill or an open destructive-command, code-execution or network-access finding.");
      console.log("Exit 1: unavailable explicit root, zero skills across explicit roots, invalid usage or checker failure.");
      process.exit(0);
    }
    const report = auditSkillRoots({ roots: cli.roots });
    if (cli.json) {
      const output = cli.includeBody ? report : { ...report, skills: report.skills.map(compactSkill) };
      process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    } else printHuman(report, cli.roots.length > 0);
    const rootError = cli.roots.length > 0 && (report.summary.skills === 0 || report.roots.some(root => root.state !== "read"));
    const commandSafety = new Set(["destructive-command", "code-execution", "network-access"]);
    const needsAttention = report.summary.statuses.broken || report.skills.some(skill => skill.findings.some(f => commandSafety.has(f.code)));
    process.exitCode = rootError ? 1 : needsAttention ? 2 : 0;
  } catch (error) {
    console.error(terminalText(`Skill Doctor failed: ${error.message}`));
    process.exitCode = 1;
  }
}

module.exports = { AXES, DEFAULT_LIMITS, auditSkillRoots, parseFrontmatter, overlapScore };
