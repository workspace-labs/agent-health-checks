"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-import-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, "README.md", "# Import context fixture\n");
  return root;
}

function put(root, relativePath, text) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test("import text a generator writes into strings, templates or comments is not a broken import", (t) => {
  const root = project(t);
  put(root, "scripts/extract.cjs", [
    "const lines = [\"/** @type {import('./types').ExampleRecord} */\", 'export default record;'];",
    "const imports = ids.map((id) => `import ${id} from \"./${id}\";`);",
    "const single = 'const a = require(\"./not-here\");';",
    "// import gone from './commented-out';",
    "/* const b = require('./block-comment'); */",
    "const re = /from \"\\.\\/regex-text\"/;",
    "const real = require('./really-missing');",
    "module.exports = { lines, imports, single, re, real };",
    "",
  ].join("\n"));
  const report = auditProject({ projectPath: root });
  const broken = report.findings.filter((finding) => finding.code === "broken-relative-import");
  assert.deepEqual(broken.map((finding) => finding.message), ["Relative import does not resolve: ./really-missing"]);
  assert.equal(broken[0].line, 7);
});

const templateImportCases = [
  ["dynamic import", ".mjs", "const value = `${import('./gone')}`;", ["./gone"]],
  ["require", ".cjs", "const value = `${require('./gone')}`;", ["./gone"]],
  ["division expression", ".mjs", "const value = `${a / b + import('./gone')}`;", ["./gone"]],
  ["nested template expression", ".mjs", "const value = `${`nested ${import('./gone')}`}`;", ["./gone"]],
  ["object expression", ".mjs", "const value = `${({ load: import('./gone') }).load}`;", ["./gone"]],
  ["nested template text", ".mjs", "const value = `${`from './text'`}`;", []],
  ["quoted and commented text", ".mjs", "const value = `${'from \"./text\"' /* import('./comment') */}`;", []],
  ["regex and executable expression", ".mjs", 'const value = `${/from ".\\/text"/.test(x) ? import("./gone") : ""}`;', ["./gone"]],
  ["escaped interpolation", ".mjs", "const value = `\\${import('./text')}`;", []],
];
for (const [label, extension, source, targets] of templateImportCases) {
  test(`F01 template import context: ${label}`, (t) => {
    const root = project(t);
    put(root, "main" + extension, source + "\n");
    const broken = auditProject({ projectPath: root }).findings.filter((item) => item.code === "broken-relative-import");
    assert.deepEqual(broken.map((item) => item.message), targets.map((target) => `Relative import does not resolve: ${target}`));
    assert.ok(broken.every((item) => item.confidence === "confirmed" && item.severity === "high" && item.line === 1));
  });
}

const regexImportCases = [
  ["if condition", 'if (ok) /from ".\\/text"/.test(value);'],
  ["if block", 'if (ok) {} /from ".\\/text"/.test(value);'],
  ["while condition", 'while (ok) /from ".\\/text"/.test(value);'],
  ["for condition", 'for (; ok;) /from ".\\/text"/.test(value);'],
  ["else statement", 'if (ok) {} else /from ".\\/text"/.test(value);'],
  ["do statement", 'do /from ".\\/text"/.test(value); while (ok);'],
  ["catch block", 'try {} catch (error) {} /from ".\\/text"/.test(value);'],
  ["function declaration", 'function load() {} /from ".\\/text"/.test(value);'],
  ["return expression", 'function load() { return /from ".\\/text"/; }'],
  ["arrow expression", 'const load = () => /from ".\\/text"/;'],
  ["TypeScript interface", 'interface I { x: number }\n/from ".\\/text"/.test(value);', ".ts"],
  ["TypeScript declare class", 'declare class C {}\n/from ".\\/text"/.test(value);', ".ts"],
];
for (const [label, source, extension = ".mjs"] of regexImportCases) {
  test(`F02 regex import context: ${label}`, (t) => {
    const root = project(t);
    // The raw import pattern must match the fixture, or the context check is untested.
    assert.match(source, /\bfrom\s*["']\./);
    put(root, "main" + extension, source + '\nimport("./gone");\n');
    const broken = auditProject({ projectPath: root }).findings.filter((item) => item.code === "broken-relative-import");
    assert.deepEqual(broken.map((item) => [item.message, item.line]), [["Relative import does not resolve: ./gone", source.split("\n").length + 1]]);
  });
}

for (const extension of [".ts", ".tsx", ".mjs", ".cjs"]) {
  test(`retained real imports after return, regex and division in ${extension}`, (t) => {
    const root = project(t);
    put(root, "main" + extension, [
      "function load() { return import('./return-missing'); }",
      "const re = /x/; import('./regex-missing');",
      "const ratio = a / b; import('./division-missing');",
      "const match = a / /x/.test(b); require('./division-regex-missing');",
      "const loadFn = function () {} / 2; import('./function-division-missing');",
    ].join("\n"));
    const broken = auditProject({ projectPath: root }).findings.filter((item) => item.code === "broken-relative-import");
    assert.deepEqual(broken.map((item) => item.line), [1, 2, 3, 4, 5]);
  });
}

for (const [label, prelude] of [
  ["division by a number after an identifier named of", "const of = 8; const ratio = of / 2;"],
  ["division by a number after an identifier named async", "const async = 8; async / 2;"],
  ["a regex following a break and line terminator", "while (flag) { break\n /'/.test('x'); }"],
  ["a hashbang containing an apostrophe", "#!/usr/bin/env -S node --title=dev's-script"],
]) {
  test(`real import survives ${label}`, (t) => {
    const root = project(t);
    put(root, "main.js", prelude + "\nimport('./gone');\n");
    const broken = auditProject({ projectPath: root }).findings.filter((item) => item.code === "broken-relative-import");
    assert.deepEqual(broken.map((item) => [item.file, item.line, item.message]), [
      ["main.js", prelude.split("\n").length + 1, "Relative import does not resolve: ./gone"],
    ]);
  });
}
