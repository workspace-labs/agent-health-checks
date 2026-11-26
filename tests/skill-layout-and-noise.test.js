"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { auditSkillRoots } = require("../skills/audit-agent-skills/scripts/audit-skills");

function scan(t, body, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-layout-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const dir = path.join(root, "atlas");
  const guide = "---\nname: atlas\ndescription: Use when cataloguing historic maps and recording their provenance.\n---\n";
  for (const [relative, text] of Object.entries({ "SKILL.md": guide + body, ...files })) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return auditSkillRoots({ roots: [dir] }).skills[0].findings;
}

const long = Array(150).fill("entry").join("\n");
for (const name of ["data.json", "table.csv"]) {
  test("a long linked " + name + " is data while a long Markdown guide needs contents", t => {
    const findings = scan(t, "[data](references/" + name + ") [guide](references/guide.md)", {
      ["references/" + name]: long, "references/guide.md": long,
    });
    assert.deepEqual(findings.map(f => [f.code, f.file]), [["reference-no-toc", "references/guide.md"]]);
  });
}

test("TOC advice accepts headings and bold labels in the first thirty Markdown lines", t => {
  const labels = ["## TOC", "###### In this file", "**Table of contents**", "__On this page__", "# Contents"];
  const files = Object.fromEntries(labels.map((label, i) =>
    ["references/" + i + ".markdown", "intro\n".repeat(29) + label + "\n" + long]));
  Object.assign(files, {
    "references/late.md": "intro\n".repeat(30) + "# Contents\n" + long,
    "references/incidental.md": "# Contents of the sample crate\n" + long,
    "references/example.md": "```md\n# Contents\n```\n" + long,
    "references/short.md": "text\n".repeat(100),
  });
  const findings = scan(t, "Read the maps.", files);
  assert.deepEqual(findings.map(f => [f.code, f.file]), [
    ["reference-no-toc", "references/example.md"],
    ["reference-no-toc", "references/incidental.md"],
    ["reference-no-toc", "references/late.md"],
  ]);
});

test("directly linked nested Markdown needs no depth advice, even when another reference also links it", t => {
  const findings = scan(t, "[guide](references/a.md) [deep](references/sub/deep.md)", {
    "references/a.md": "[deep](sub/deep.md)", "references/sub/deep.md": "Prepare maps.",
    "references/sub/orphan.md": "Unlinked draft.",
  });
  assert.deepEqual(findings, []);
});

test("a reachable Markdown chain marks indirect files once and ignores disconnected cycles and examples", t => {
  const findings = scan(t, "[guide](references/a.md)", {
    "references/a.md": "[b](b.markdown) [b again](b.markdown#section)\n    [example](example.md)",
    "references/b.markdown": "[c](c.md) [cycle](a.md)",
    "references/c.md": "[b](b.markdown)",
    "references/unused.md": "[other](other.md)", "references/other.md": "[cycle](unused.md)",
    "references/example.md": "A code sample.",
  });
  assert.deepEqual(findings.map(f => [f.code, f.file, f.message]), [
    ["deep-reference", "references/b.markdown", "Reference is reachable only through another reference: references/b.markdown"],
    ["deep-reference", "references/c.md", "Reference is reachable only through another reference: references/c.md"],
  ]);
});

test("ordinary filenames, commands and project paths stay quiet while bundled and escaping references retain their verdicts", t => {
  const noise = ["Info.plist", "README.md", "BACKLOOP.md", "pipeline.js", "1.0.0", "/app-onboarding",
    "e.g", "Animate.css", "engineering/ADR.md"];
  const findings = scan(t, [...noise.map(value => "Open `" + value + "`."),
    "Read ../web-quality-audit/SKILL.md.", "Read manual/missing.md.",
    "Read [missing](unavailable.md). Read scripts/gone.sh.",
    "Read [present](manual/present.md).",
  ].join("\n"), { "manual/present.md": "[diagram](missing.png)" });
  assert.deepEqual(findings.map(f => [f.code, f.message]), [
    ["broken-reference", "Referenced file does not exist: unavailable.md"],
    ["broken-reference", "Referenced file does not exist: scripts/gone.sh"],
    ["unverified-reference", "Could not verify reference: ../web-quality-audit/SKILL.md"],
    ["unverified-reference", "Could not verify reference: manual/missing.md"],
    ["unverified-reference", "Could not verify reference: missing.png"],
  ]);
});

test("Markdown and HTML links inside multiline code spans do not make reference files reachable", t => {
  const findings = scan(t, [
    "[start](references/a.md)", "A `multiline example", "[example](scripts/missing.sh)", "ends here`.",
  ].join("\n"), {
    "references/a.md": [
      "Some `multiline code", "[example](b.md) <a href='c.md'>sample</a> [absent](missing.md)",
      "ends here`. [real](d.md) <a href='e.md'>also real</a>",
    ].join("\n"),
    "references/b.md": "", "references/c.md": "", "references/d.md": "", "references/e.md": "",
  });
  assert.deepEqual(findings.map(f => [f.code, f.message]), [
    ["broken-reference", "Referenced file does not exist: scripts/missing.sh"],
    ["deep-reference", "Reference is reachable only through another reference: references/d.md"],
    ["deep-reference", "Reference is reachable only through another reference: references/e.md"],
  ]);
});

test("a guide naming root and bundled Markdown files makes them direct pointers", t => {
  const findings = scan(t, [
    "[index](README.md)", "The list lives in `DROPPED.md` and PLAIN.md.",
    "Other entries include `references/quoted.md` and references/plain.md.",
    "An example backup is indirect.md.bak, in a separate folder named old/indirect.md.",
    "This table also points to `Old Editions.md`.",
    "The collection also describes ABSENT.md.",
  ].join("\n"), {
    "README.md": "[a](DROPPED.md) [b](PLAIN.md) [c](references/quoted.md) [d](references/plain.md) [e](Old%20Editions.md) [only here](indirect.md)",
    "DROPPED.md": "", "PLAIN.md": "", "references/quoted.md": "", "references/plain.md": "", "Old Editions.md": "", "indirect.md": "",
  });
  assert.deepEqual(findings.map(f => [f.code, f.file]), [["deep-reference", "indirect.md"]]);
});
