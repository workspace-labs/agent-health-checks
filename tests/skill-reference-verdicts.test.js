"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { auditSkillRoots } = require("../skills/audit-agent-skills/scripts/audit-skills");

function scan(t, body, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reference-verdicts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const guide = "---\nname: sample\ndescription: Use when assembling a reference collection for an archive.\n---\n";
  for (const [name, content] of Object.entries({ "SKILL.md": guide + body, ...files })) {
    const file = path.join(root, "sample", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return auditSkillRoots({ roots: [root] }).skills[0];
}

function assertSingle(skill, status, code, value) {
  assert.equal(skill.status, status);
  const severity = code === "broken-reference" ? "error" : "review";
  const prefix = code === "broken-reference" ? "Referenced file does not exist: " : "Could not verify reference: ";
  assert.deepEqual(skill.findings.map(f => [f.code, f.severity, f.message]), [[code, severity, prefix + value]]);
}

test("a caller's build command receives review in SKILL.md", t => {
  assertSingle(scan(t, "Prefer `./gradlew`."), "Needs review", "unverified-reference", "./gradlew");
});

test("escaped Markdown and a multiline code span cannot create a broken link", t => {
  const skill = scan(t, [
    "Example text: \\[escaped](escaped.md).",
    "Code spelling: `a multiline",
    "[example](in-code.md)",
    "sample`. Real link [guide `id`](missing.md).",
    "",
    "An unmatched `tick with [another guide](second.md).",
    "",
    "[known](",
    '  known.md "Long title") then [third guide](third.md).',
  ].join("\n"), { "known.md": "" });
  assert.deepEqual(skill.findings.filter(f => f.code === "broken-reference").map(f => f.message),
    ["Referenced file does not exist: missing.md", "Referenced file does not exist: second.md",
      "Referenced file does not exist: third.md"]);
});

for (const file of ["README.md", "references/guide.md", "RESEARCH.md"]) {
  test("a missing local picture in " + file + " receives review", t => {
    const skill = scan(t, "Prepare a record.", { [file]: "![example](missing.png)" });
    assertSingle(skill, "Needs review", "unverified-reference", "missing.png");
  });
}

for (const target of ["./scripts/missing.sh", "references/missing.md", "${CLAUDE_SKILL_DIR}/assets/missing.svg"]) {
  test("SKILL.md identifies a missing conventional bundle path " + target, t => {
    const body = target.startsWith("references/") ? "- `" + target + "`" : "Run `" + target + "`.";
    assertSingle(scan(t, body), "Broken", "broken-reference", target);
  });
}

test("agents/openai.yaml distinguishes conventional asset paths from other icon paths", t => {
  const skill = scan(t, "Prepare a record.", {
    "agents/openai.yaml": 'interface:\n  icon_small: "./assets/small.svg"\n  icon_large: "./icons/large.svg"\n',
  });
  assert.deepEqual(skill.findings.map(f => [f.file, f.code, f.severity, f.message]), [
    ["agents/openai.yaml", "broken-reference", "error", "Referenced file does not exist: ./assets/small.svg"],
    ["agents/openai.yaml", "unverified-reference", "review", "Could not verify reference: ./icons/large.svg"],
  ]);
});

test("an external relative link receives review even if an earlier component is missing", t => {
  for (const target of ["../external.txt", "absent/../../external.txt"]) {
    assertSingle(scan(t, "[example](" + target + ")"), "Needs review", "unverified-reference", target);
  }
});

test("only the Markdown link is a hard claim for an unconventional folder in SKILL.md", t => {
  const skill = scan(t, [
    "See [manual](manual/missing.md).",
    "See manual/other.md.",
    '<img src="manual/picture.png">',
    "    [example](code-sample.md)",
  ].join("\n"), { "manual/present.md": "" });
  assert.equal(skill.findings.filter(f => f.code === "broken-reference").length, 1);
  assert.equal(skill.findings[0].message, "Referenced file does not exist: manual/missing.md");
  assert.ok(skill.findings.some(f => f.message === "Could not verify reference: manual/other.md"));
  assert.ok(skill.findings.some(f => f.message === "Could not verify reference: manual/picture.png"));
});
