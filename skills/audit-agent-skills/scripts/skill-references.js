"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { comparePath, inside } = require("./skill-paths");
const { escapedMarkdown, inlineCodeLookup } = require("./skill-markdown-code");

// Markdown destinations use the containing document. Instruction paths beginning with a
// bundled folder or the skill-directory variable use the skill's installation directory.
const markdownFile = name => /\.(?:md|markdown)$/i.test(name);

function referencesIn(file, bundleFolders, knownMarkdown = null) {
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

    const guideProse = file.rel === "SKILL.md" && !fence && !/^(?: {4}|\t)/.test(line);
    function add(raw, kind, instruction = false, mention = false) {
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
      // A named guide already in this skill is a direct pointer even without a link or a verb.
      const namedGuide = mention && guideProse && knownMarkdown?.has(target);
      const explicit = anchored || target.startsWith("./") || bundled || conventional || namedGuide;
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
        if (guideProse && knownMarkdown?.has(span)) {
          add(span, "text", instruction, true);
          continue;
        }
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
        add(match[3], "text", instruction, guideProse && !inCode(i, match.index + match[0].length - match[3].length));
      }
    }
  }
  return refs.values();
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

module.exports = { markdownFile, referencesIn, referenceInspector, needsContents, indirectReferences };
