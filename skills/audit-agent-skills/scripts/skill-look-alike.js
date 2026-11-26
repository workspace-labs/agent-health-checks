"use strict";

const { finding } = require("./skill-findings");
const { comparePath } = require("./skill-paths");
const { excerpt } = require("./skill-excerpt");

// Compare the common prefix once. At the first difference, only the
// replacement, one-character gap, or adjacent transposition can be an edit.
function oneEdit(a, b) {
  if (a.length > b.length) return oneEdit(b, a);
  if (b.length - a.length > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i === a.length) return b.length === a.length + 1;
  let j = i + 1;
  if (a.length === b.length) {
    if (a[i] === b[j] && a[j] === b[i]) j++; // Swapped neighbours.
    i = j;
  }
  while (i < a.length && a[i] === b[j]) { i++; j++; }
  return i === a.length;
}

function addLookAlikes(byName) {
  const entries = [];
  for (const name of [...byName.keys()].sort(comparePath)) {
    // Only supplementary characters require converting the UTF-16 string.
    const chars = /[\uD800-\uDBFF]/.test(name) ? Array.from(name) : name;
    if (chars.length >= 5) entries.push({
      name, chars, folded: name.replace(/0/g, "o").replace(/[1i]/g, "l").replace(/rn/g, "m"),
    });
  }
  for (const entry of entries) {
    const other = entries.find(candidate => candidate !== entry &&
      (candidate.folded === entry.folded || oneEdit(entry.chars, candidate.chars)));
    if (!other) continue;
    for (const skill of byName.get(entry.name).cards) {
      skill.findings.push(finding("portability", "review", "look-alike-name",
        "Name is one keystroke from another installed skill: " + excerpt(other.name), "SKILL.md", 1,
        "Check that both are genuine; this compares installed skills only and knows no list of real names."));
      skill.axes.portability = "review";
    }
  }
}

module.exports = { addLookAlikes };
