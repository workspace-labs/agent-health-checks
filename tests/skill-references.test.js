"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { auditSkillRoots } = require("../skills/audit-agent-skills/scripts/audit-skills");

function fixture(t, body, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundled-refs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "bundle");
  for (const [relative, content] of Object.entries({
    "SKILL.md": ["---", "name: bundle", "description: Use when examining a collection of archive material.", "---", body].join("\n"),
    ...files,
  })) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return { dir, scan: (limits) => auditSkillRoots({ roots: [root], limits }).skills[0] };
}

const referenceFindings = (skill) => skill.findings.filter(f =>
  ["broken-reference", "reference-escape", "unverified-reference"].includes(f.code));

test("existing files survive prose punctuation, Markdown titles, URL escapes and balanced parentheses", t => {
  const { scan } = fixture(t, [
    'Run scripts/run.sh. Read [the guide](references/guide.md "Guide title").',
    "[encoded](references/a%20b.md#contents 'Title') and [parentheses](references/a(b).md).",
    "[angle](<references/a b.md> \"Title\")",
    'Use `${CLAUDE_SKILL_DIR}/references/guide.md`.',
  ].join("\n"), {
    "scripts/run.sh": "", "references/guide.md": "", "references/a b.md": "", "references/a(b).md": "",
  });
  assert.equal(scan().status, "Universal");
});

test("a link into dist checks the disk even when its target lies beyond the file budget", t => {
  const { scan } = fixture(t, "[tool](dist/tool.js) and [absent](dist/absent.js).", {
    "a.txt": "", "b.txt": "", "dist/tool.js": "",
  });
  for (const limits of [undefined, { maxFiles: 1 }]) {
    assert.deepEqual(referenceFindings(scan(limits)).map(f => f.message), ["Referenced file does not exist: dist/absent.js"]);
  }
});

test("conventional missing paths in code and prose are Broken while other bundle folders receive review", t => {
  const { scan } = fixture(t, [
    "Run `./scripts/missing.sh` and `./scripts/ok.sh`.",
    "Read ${CLAUDE_SKILL_DIR}/references/gone.md and ${CLAUDE_SKILL_DIR}/references/ok.md.",
    "See recipes/missing.txt and recipes/ok.txt.",
  ].join("\n"), { "scripts/ok.sh": "", "references/ok.md": "", "recipes/ok.txt": "" });
  const skill = scan();
  assert.equal(skill.status, "Broken");
  assert.deepEqual(referenceFindings(skill).map(f => [f.file, f.line, f.severity, f.message]), [
    ["SKILL.md", 5, "error", "Referenced file does not exist: ./scripts/missing.sh"],
    ["SKILL.md", 6, "error", "Referenced file does not exist: ${CLAUDE_SKILL_DIR}/references/gone.md"],
    ["SKILL.md", 7, "review", "Could not verify reference: recipes/missing.txt"],
  ]);
});

test("nested Markdown links use their document directory while bundle paths and YAML icons use the skill root", t => {
  const { scan } = fixture(t, "Read [guide](manual/guide.md).", {
    "manual/guide.md": [
      "[sibling](notes.md) [absent](missing.md)",
      "Read icons/small.svg and ${CLAUDE_SKILL_DIR}/icons/small.svg.",
      "![missing][figure]", "[figure]: ../icons/figure.svg \"Figure\"",
    ].join("\n"),
    "manual/notes.md": "", "icons/small.svg": "",
    "agents/openai.yaml": 'interface:\n  icon_small: "./icons/small.svg"\n  icon_large: "./icons/large.svg"',
  });
  assert.deepEqual(referenceFindings(scan()).map(f => [f.file, f.line, f.message]), [
    ["agents/openai.yaml", 3, "Could not verify reference: ./icons/large.svg"],
    ["manual/guide.md", 1, "Could not verify reference: missing.md"],
    ["manual/guide.md", 4, "Could not verify reference: ../icons/figure.svg"],
  ]);
});

test("Markdown destinations are checked once and labeled placeholders and code samples stay quiet", t => {
  const { scan } = fixture(t, [
    "[scripts/missing.sh](scripts/missing.sh)",
    "[template](path/to/file.md) `scripts/<name>.sh` scripts/{name}.sh scripts/.../run.sh",
    "[angle placeholder](scripts/<name>.sh) [brace placeholder](scripts/{name}.sh)",
    "[URL](https://example.com/docs/guide.md) [contents](#contents)",
    "```js", "handlers[kind](entry)", "```",
  ].join("\n"), { "scripts/control.sh": "" });
  assert.deepEqual(referenceFindings(scan()).map(f => f.message), ["Referenced file does not exist: scripts/missing.sh"]);
});

test("absolute and home links and uncertain relative file references receive an exact review note", t => {
  const { scan } = fixture(t, [
    "[host](/etc/hosts) [home](~/shared/index.md)",
    "Read `elsewhere/example.md`. Use [sibling](../other/notes.md).",
  ].join("\n"));
  const findings = referenceFindings(scan());
  assert.deepEqual(findings.filter(f => f.code === "unverified-reference").map(f => [f.axis, f.severity, f.message]), [
    ["structure", "review", "Could not verify reference: /etc/hosts"],
    ["structure", "review", "Could not verify reference: ~/shared/index.md"],
    ["structure", "review", "Could not verify reference: ../other/notes.md"],
  ]);
  assert.equal(findings.some(f => f.severity === "error"), false);
});

test("every on-disk directory segment and filename must match the reference's case", t => {
  const { scan } = fixture(t, "[ok](tools/Guide.md) [wrong file](tools/guide.md) [wrong folder](Tools/Guide.md)", {
    "tools/Guide.md": "",
  });
  assert.deepEqual(referenceFindings(scan()).map(f => f.message),
    ["Referenced file does not exist: tools/guide.md", "Referenced file does not exist: Tools/Guide.md"]);
});

test("a reference passing through an external link cannot confirm presence or absence", { skip: process.platform === "win32" }, t => {
  const { dir, scan } = fixture(t, "[file](through/SKILL.md) [absent](through/missing.md)");
  fs.symlinkSync(path.dirname(dir), path.join(dir, "through"));
  assert.deepEqual(referenceFindings(scan()).map(f => [f.code, f.severity, f.message]), [
    ["unverified-reference", "review", "Could not verify reference: through/SKILL.md"],
    ["unverified-reference", "review", "Could not verify reference: through/missing.md"],
  ]);
});

test("an instruction operand in an absent folder stays quiet alongside descriptions of another project's layout", t => {
  const { scan } = fixture(t, [
    "An application can have files such as `example/a.js` or `sample/other.md`.",
    "The scanner inspects project files in `example/data.csv`.",
    "Read the guide `other/missing.md`.",
  ].join("\n"));
  assert.deepEqual(referenceFindings(scan()), []);
});

test("the CLI reports both shipped skill guides as Universal", () => {
  const { execFileSync } = require("node:child_process");
  const root = path.join(__dirname, "..", "skills");
  const checker = path.join(root, "audit-agent-skills", "scripts", "audit-skills.js");
  const report = JSON.parse(execFileSync(process.execPath, [checker, "--json", "--root", root], { encoding: "utf8" }));
  assert.deepEqual(report.skills.map(s => [s.name, s.status]), [
    ["audit-agent-skills", "Universal"], ["audit-project-health", "Universal"],
  ]);
});

test("shell examples validate explicit command operands while code examples stay quiet", t => {
  const { scan } = fixture(t, [
    "```bash", "bash ./scripts/missing.sh", "bash ./scripts/present.sh", "```",
    "```js", "return handlers[kind](entry);", "```",
  ].join("\n"), { "scripts/present.sh": "" });
  assert.deepEqual(referenceFindings(scan()).map(f => f.message), ["Referenced file does not exist: ./scripts/missing.sh"]);
});

test("the explicit link keeps its certainty when repeated as an ambiguous operand on the same line", t => {
  const { scan } = fixture(t, "Read `unknown/path.md` or [open it](unknown/path.md).");
  assert.deepEqual(referenceFindings(scan()).map(f => f.message), ["Referenced file does not exist: unknown/path.md"]);
});

test("inline command arguments and source line numbers stay outside the referenced filename", t => {
  const { scan } = fixture(t, [
    "Run `scripts/run.sh deck.pptx`. Run `scripts/run.sh --flag scripts/gone.sh`.",
    "Read references/record.md:12:3 and `references/note%20one.md:15`.",
    "Use `references/note one.md` and `scripts/tool.js --help`.",
  ].join("\n"), { "scripts/run.sh": "", "scripts/tool.js": "", "references/record.md": "", "references/note one.md": "" });
  assert.deepEqual(referenceFindings(scan()).map(f => f.message), ["Referenced file does not exist: scripts/gone.sh"]);
});

test("nested instructions accept present files under either working directory and retain document-relative link semantics", t => {
  const { scan } = fixture(t, "Open [the tutorial](manual/guide.md).", {
    "manual/guide.md": [
      "Run ./tools/from-root.sh and ./from-here.sh.",
      "Run ./tools/gone.sh. [relative link](./tools/from-root.sh)",
      "```sh", "tool --output ./new.svg ./tools/from-root.sh", "```",
      "Run `tool -o ./result.png ./from-here.sh`.",
    ].join("\n"), "manual/from-here.sh": "", "tools/from-root.sh": "",
  });
  assert.deepEqual(referenceFindings(scan()).map(f => [f.line, f.message]), [
    [2, "Could not verify reference: ./tools/gone.sh"], [2, "Could not verify reference: ./tools/from-root.sh"],
  ]);
});

test("bare absolute and home paths stay quiet while their explicit Markdown links receive review", t => {
  const { scan } = fixture(t, [
    "Open ~/private/guide.md. Read /etc/hosts.",
    "Open `~/private/control.txt`.",
    "Installations commonly live in `~/local/tools`.",
    "[guide](~/private/guide.md) [hosts](/etc/hosts)",
  ].join("\n"));
  assert.deepEqual(referenceFindings(scan()).map(f => f.message), [
    "Could not verify reference: ~/private/guide.md", "Could not verify reference: /etc/hosts",
  ]);
});

test("an internal link can resolve within the skill and normalized spellings on one line yield one finding", {
  skip: process.platform === "win32",
}, t => {
  const { dir, scan } = fixture(t, [
    "Read [existing](alias/guide.md) and [absent](alias/gone%20file.md) or [again](<alias/gone file.md>).",
  ].join("\n"), { "manual/guide.md": "" });
  fs.symlinkSync("manual", path.join(dir, "alias"));
  assert.deepEqual(referenceFindings(scan()).map(f => f.message), ["Referenced file does not exist: alias/gone file.md"]);
});

test("skill-directory variables identify root-level files in prose without an action verb", t => {
  const { scan } = fixture(t, "Inputs are ${CLAUDE_SKILL_DIR}/known.txt and ${CLAUDE_SKILL_DIR}/missing.", { "known.txt": "" });
  assert.deepEqual(referenceFindings(scan()).map(f => f.message), ["Could not verify reference: ${CLAUDE_SKILL_DIR}/missing"]);
});

test("bare instruction filenames and non-Latin bundled folders include their missing and existing controls", t => {
  const { scan } = fixture(t, [
    "Read missing.md. Open invoice.csv. Read present.md. Open paid.csv.",
    "The sources are ملفات/gone.md and ملفات/ok.md.",
  ].join("\n"), { "present.md": "", "paid.csv": "", "ملفات/ok.md": "" });
  assert.deepEqual(referenceFindings(scan()).map(f => [f.code, f.message]), [
    ["unverified-reference", "Could not verify reference: ملفات/gone.md"],
  ]);
});

test("multiline Markdown destinations preserve opening evidence, link titles, and the following line's references", t => {
  const { scan } = fixture(t, [
    "[guide](", "  absent.md", ") and [image](missing.svg).",
    "[ok](", '  <known file.md> "A title"', ")",
  ].join("\n"), { "known file.md": "" });
  assert.deepEqual(referenceFindings(scan()).map(f => [f.line, f.message]), [
    [5, "Referenced file does not exist: absent.md"], [7, "Referenced file does not exist: missing.svg"],
  ]);
});

test("references into unread dependency and cache folders check filenames while Git stays unread", t => {
  const { scan } = fixture(t, [
    "[ok](node_modules/x/bin.js) [absent](node_modules/x/missing.js)",
    "[cache](__pycache__/file.pyc) [missing cache](__pycache__/missing.pyc)",
    "[history](.git/config)",
  ].join("\n"), { "node_modules/x/bin.js": "", "__pycache__/file.pyc": "", ".git/config": "" });
  assert.deepEqual(referenceFindings(scan()).map(f => [f.code, f.message]), [
    ["broken-reference", "Referenced file does not exist: node_modules/x/missing.js"],
    ["broken-reference", "Referenced file does not exist: __pycache__/missing.pyc"],
    ["unverified-reference", "Could not verify reference: .git/config"],
  ]);
});

test("Markdown HTML images and anchors name local destinations, including root files, and fenced markup is an example", t => {
  const { scan } = fixture(t, [
    '<img alt="example" src="missing.png"> <A HREF=missing.md>guide</A>',
    '<img alt="src=misleading.png" src="images/ok.png"> <a href="present.md">guide</a>',
    '<img src="images/gone.png">',
    "```html", '<img src="example.png">', "```",
  ].join("\n"), { "images/ok.png": "", "present.md": "" });
  assert.deepEqual(referenceFindings(scan()).map(f => f.message), [
    "Could not verify reference: missing.png", "Could not verify reference: missing.md",
    "Could not verify reference: images/gone.png",
  ]);
});
