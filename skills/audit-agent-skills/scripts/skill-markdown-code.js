"use strict";

function escapedMarkdown(text, at) {
  let start = at;
  while (start > 0 && text[start - 1] === "\\") start--;
  return (at - start) % 2 === 1;
}

const referenceBoundary = line => /^ {0,3}(?:`{3,}|~{3,})/.test(line);

// Index matching backtick widths once per paragraph. Unmatched openings cannot
// hide later markup or cause repeated forward scans of untrusted input.
function codeSpanIndex(lines, boundary = referenceBoundary) {
  const starts = [], ends = new Map(), previous = new Map();
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    if (!line.trim() || boundary(line)) previous.clear();
    else {
      for (const match of line.matchAll(/`+/g)) {
        const width = match[0].length;
        const at = offset + match.index;
        const prior = previous.get(width);
        if (prior !== undefined) ends.set(prior, at + width);
        if (escapedMarkdown(line, match.index)) previous.delete(width);
        else {
          // Seed the map in document order; its values fill in as closers arrive.
          ends.set(at, undefined);
          previous.set(width, at);
        }
      }
    }
    offset += line.length + 1;
  }
  return { starts, ends };
}

// The reference reader asks about positions in ascending document order.
function inlineCodeLookup(lines, boundary) {
  const { starts, ends } = codeSpanIndex(lines, boundary);
  const spans = [];
  let after = 0;
  for (const [at, end] of ends) {
    if (at < after || end === undefined) continue;
    spans.push([at, end]);
    after = end;
  }
  let index = 0;
  return (line, column) => {
    const at = starts[line] + column;
    while (index < spans.length && spans[index][1] <= at) index++;
    if (index === spans.length || at < spans[index][0]) return "";
    return at === spans[index][0] ? "opening" : "inside";
  };
}

module.exports = { escapedMarkdown, inlineCodeLookup, codeSpanIndex };
