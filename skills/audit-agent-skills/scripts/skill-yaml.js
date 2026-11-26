"use strict";

const { finding } = require("./skill-findings");

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

module.exports = { lineOf, scalar, readYaml, parseFrontmatter, yamlFinding };
