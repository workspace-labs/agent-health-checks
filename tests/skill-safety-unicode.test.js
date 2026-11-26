"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { auditText } = require("./support/safety-text");

const code = "hidden-characters";
const suggestion = "Open the file in a hex view; remove the characters unless they are ordinary writing.";
const tags = ascii => Array.from(ascii, letter => String.fromCodePoint(0xe0000 + letter.charCodeAt(0))).join("");
const hiddenSentence = tags("inert fixture text: this sentence cannot be seen by a human reviewer");
const tagFlag = code => "\u{1f3f4}" + tags(code) + "\u{e007f}";
const flag = tagFlag("gbeng");

const examples = [
  ["tags in the guide body", "SKILL.md", "Notes\nKeep the summary short." + hiddenSentence, 6, 68, "Unicode tags"],
  ["tags in the description", "SKILL.md", "---\nname: sample\ndescription: Use when summarizing a text report." +
    hiddenSentence + "\n---\nUse short sentences.", 3, 68, "Unicode tags"],
  ["tags in a reference", "references/guide.md", "# Guide\n\nUse short sentences." + hiddenSentence, 3, 68, "Unicode tags"],
  ["direction override", "notes.txt", "File name: \u202etxt.troper\u202c", 1, 2, "direction controls"],
  ["direction embeddings and isolates", "notes.txt", "\u202a\u202b\u202d\u2066\u2067\u2068\u2069", 1, 7, "direction controls"],
  ["zero-width run", "notes.txt", "Keep the summary short." +
    Array.from("0110100101101110", bit => bit === "0" ? "\u200b" : "\u200c").join(""), 1, 16, "zero-width characters"],
  ["noninitial BOM in a run", "notes.txt", "\ufeffText\n\u2060\u200d\ufeff", 2, 3, "zero-width characters"],
  ["supplementary variation selectors", "notes.txt", "Done.✨" +
    Array.from({ length: 12 }, (_, i) => String.fromCodePoint(0xe0100 + i)).join(""), 1, 12, "variation selectors"],
  ["mixed variation selector ranges", "notes.txt", "Text\n\ufe00\u{e01ef}\ufe0f", 2, 3, "variation selectors"],
  ["30 tag letters inside a black flag", "notes.txt", "Notes\nHi " + tagFlag("inert".repeat(6)) + " there", 2, 31, "Unicode tags"],
  ["flag with only a country prefix", "notes.txt", tagFlag("gb"), 1, 3, "Unicode tags"],
  ["flag with four subdivision letters", "notes.txt", tagFlag("gbabcd"), 1, 7, "Unicode tags"],
  ["digit in the country prefix", "notes.txt", tagFlag("g1a"), 1, 4, "Unicode tags"],
  ["unclosed flag", "notes.txt", "\u{1f3f4}" + tags("gbeng"), 1, 5, "Unicode tags"],
  ["punctuation in a flag", "notes.txt", "\u{1f3f4}" + tags("a!") + "\u{e007f}", 1, 3, "Unicode tags"],
  ["tags adjoining a valid flag", "notes.txt", "\u{e0000}" + flag + "\u{e007f}", 1, 2, "Unicode tags"],
];

for (const [name, file, content, line, count, kind] of examples) {
  test("hidden-characters reports " + name + " without printing it", t => {
    const hits = auditText(t, content, file).filter(finding => finding.code === code);
    assert.deepEqual(hits, [{ axis: "safety", severity: "review", code,
      message: `Text holds ${count} invisible or direction-changing characters (${kind})`,
      file, line, suggestion }]);
  });
}

test("hidden-characters combines kinds across lines at the first affected line", t => {
  const text = flag + "\r\n\u2066text\u2069\r\n\u200c\u200b\u200d\n\u2067";
  const hits = auditText(t, text).filter(finding => finding.code === code);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].message, "Text holds 6 invisible or direction-changing characters (direction controls, zero-width characters)");
});

const controls = [
  ["family emoji and keycap", "Family: 👨\u200d👩\u200d👧 done ✔\ufe0f and 1\ufe0f\u20e3 first."],
  ["England flag", flag + " England"],
  ["Scotland flag", tagFlag("gbsct")],
  ["Wales flag", tagFlag("gbwls")],
  ["one subdivision digit", tagFlag("gb0")],
  ["three subdivision letters and digits", tagFlag("gb9a0")],
  ["Arabic directional marks and Persian non-joiner", "التقرير الأسبوعي\u200f (PDF)\u200e می\u200cخواهم."],
  ["initial BOM", "\ufeffOrdinary text."],
  ["plain text", "Ordinary text."],
  ["initial BOM before two joiners", "\ufeff\u200c\u200d"],
  ["one or two selectors per run", "✨\ufe0f\u{e0100}a\u{e01ef}\u{e0100}"],
  ["separated short runs", "\u200b\u200b\n\u200b\u2060\n\ufeff\u200d"],
];

for (const [name, content] of controls) {
  test("hidden-characters leaves " + name + " quiet", t => {
    assert.deepEqual(auditText(t, content).filter(finding => finding.axis === "safety"), []);
  });
}
