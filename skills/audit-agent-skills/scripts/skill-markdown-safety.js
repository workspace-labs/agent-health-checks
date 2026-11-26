"use strict";

const { finding } = require("./skill-findings");
const { markdownFile } = require("./skill-references");
const { escapedMarkdown, inlineCodeLookup, codeSpanIndex } = require("./skill-markdown-code");
const { excerpt } = require("./skill-excerpt");

const pragma = /^(?:markdownlint-|\/?prettier-ignore\b|textlint-|cspell:|vale\b|toc(?:stop)?\b|(?:start\s+|end\s+)?doctoc\b|omit (?:in|from) toc\b|more\b|end\b|begin\b|\/?eslint-)/i;

// A backtick in a backtick fence's info string makes the line ordinary prose.
function fenceMarker(line) {
  const match = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
  if (match && (match[1][0] !== "`" || !match[2].includes("`"))) return match;
}

// An opening line may start in blockquotes or explicitly start a list item.
// Keep their prefixes so a closing fence belongs to the same container.
function openingFence(line) {
  if (!line.includes("```") && !line.includes("~~~")) return;
  const containers = [];
  const prefix = / {0,3}(?:(>)[ \t]?|(?:[-+*]|\d{1,9}[.)]) {1,4}(?! ))/y;
  let offset = 0, match;
  while ((match = prefix.exec(line))) {
    containers.push(match[1] ? ">" : match[0].length);
    offset = prefix.lastIndex;
  }
  const marker = fenceMarker(line.slice(offset));
  if (marker) return { containers, marker: marker[1], info: marker[2] };
}

function continuation(line, containers) {
  let offset = 0;
  const quote = / {0,3}>[ \t]?/y;
  for (const container of containers) {
    if (container === ">") {
      quote.lastIndex = offset;
      if (!quote.test(line)) return;
      offset = quote.lastIndex;
    } else {
      if (!line.startsWith(" ".repeat(container), offset)) {
        return line.slice(offset).trim() ? undefined : "";
      }
      offset += container;
    }
  }
  return line.slice(offset);
}

function fenceReader() {
  let fence;
  return line => {
    if (fence) {
      const content = continuation(line, fence.containers);
      if (content !== undefined) {
        const close = fenceMarker(content);
        if (close && close[1].startsWith(fence.marker) && !close[2].trim()) fence = undefined;
        return "code";
      }
      fence = undefined;
    }
    fence = openingFence(line);
    if (fence) return fence.marker === "```" && /^![ \t]*$/.test(fence.info) ? "load" : "code";
  };
}

// A blank placeholder for each fenced line keeps line numbers stable and stops
// an unclosed inline code span crossing into or out of a fenced block.
function codeContext(lines) {
  const readFence = fenceReader(), loadFences = new Set();
  const visible = lines.map((line, index) => {
    const state = readFence(line);
    if (state === "load") loadFences.add(index);
    return state ? "" : line;
  });
  return { visible, loadFences, inCode: inlineCodeLookup(visible, () => false) };
}

function firstLoadCommand(file, bodyStart) {
  const body = file.text.slice(bodyStart);
  if (!body.includes("!`") && !body.includes("```!")) return;
  const lines = body.split(/\r?\n/);
  const { visible, loadFences, inCode } = codeContext(lines);
  for (let i = 0; i < lines.length; i++) {
    let evidence;
    if (loadFences.has(i)) evidence = "```!";
    else {
      for (const match of visible[i].matchAll(/(?:^|[ \t])(!`[^`\r\n]+`)/g)) {
        const bang = match.index + match[0].length - match[1].length;
        if (inCode(i, bang)) continue;
        evidence = match[1];
        break;
      }
    }
    if (evidence) {
      const line = file.text.slice(0, bodyStart).split("\n").length + i;
      return finding("safety", "review", "load-time-command",
        "Runs a command when the skill loads (Claude Code): " + excerpt(evidence), file.rel, line,
        "Read the command; in Claude Code it runs before the model sees the skill, without asking.");
    }
  }
}

function hiddenComment(file) {
  if (!file.text.includes("<!--")) return;
  const text = file.text.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const { starts, ends } = codeSpanIndex(lines, openingFence);
  const readFence = fenceReader();
  let resume = 0, count = 0, firstLine, preview;
  for (let i = 0; i < lines.length; i++) {
    const offset = starts[i], line = lines[i];
    if (resume > offset && resume >= offset + line.length) continue;
    if (resume <= offset && readFence(line)) continue;
    const tokens = /<!--|`+/g;
    tokens.lastIndex = Math.max(0, resume - offset);
    let token;
    while ((token = tokens.exec(line))) {
      const start = token.index;
      if (token[0] !== "<!--") {
        const end = ends.get(offset + start);
        if (end !== undefined) {
          resume = end;
          tokens.lastIndex = end - offset;
        }
        continue;
      }
      if (escapedMarkdown(line, start)) continue;
      // HTML comments consume raw text through their terminator, including code
      // examples embedded in the comment. Advance past it before looking again.
      const contentAt = offset + start + 4;
      const end = text.indexOf("-->", contentAt);
      if (end < 0) return result();
      const inner = text.slice(contentAt, end).trim();
      if (!pragma.test(inner)) {
        const chars = Array.from(inner.slice(0, 120)).slice(0, 60);
        if (chars.length >= 40 && ++count === 1) {
          firstLine = i + 1;
          preview = excerpt(chars.join(""));
        }
      }
      resume = end + 3;
      tokens.lastIndex = resume - offset;
    }
  }
  return result();

  function result() {
    if (count) return finding("safety", "review", "hidden-comment",
      count + " comment(s) hidden from previews; first: " + preview, file.rel, firstLine,
      "Read the comment; agents receive it even though previews do not show it.");
  }
}

function markdownSafetyFindings(file, bodyStart) {
  if (!markdownFile(file.rel)) return [];
  const load = file.rel === "SKILL.md" && firstLoadCommand(file, bodyStart);
  return [load, hiddenComment(file)].filter(Boolean);
}

module.exports = { markdownSafetyFindings };
