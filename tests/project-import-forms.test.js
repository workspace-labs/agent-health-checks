"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");

function scan(t, source, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-import-forms-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries({ "README.md": "# Imports", "app.mjs": source, ...files })) {
    fs.writeFileSync(path.join(root, name), contents);
  }
  return auditProject({ projectPath: root });
}

const forms = [
  ["side-effect module", "import './target.mjs';", "target.mjs"],
  ["side-effect CSS", 'import "./target.css";', "target.css"],
  ["require.resolve", "require.resolve('./target.js');", "target.js"],
  ["require with backticks", "require(`./target.js`);", "target.js"],
  ["dynamic import with backticks", "import(`./target.js`);", "target.js"],
  ["dynamic import with a loader comment", "import(/* webpackChunkName: 'x' */ './target.js');", "target.js"],
];
for (const [name, expression, target] of forms) {
  test(`${name} reports the missing file only in executable code`, t => {
    const source = ["// " + expression, "const example = " + JSON.stringify(expression) + ";", expression];
    const report = scan(t, source.join("\n"));
    assert.deepEqual(report.findings.map(f => [f.code, f.line, f.message]), [
      ["broken-relative-import", 3, `Relative import does not resolve: ./${target}`],
    ]);
    assert.deepEqual(scan(t, expression, { [target]: "" }).findings, []);
  });
}

test("runtime path fragments stay quiet while a nested literal import remains visible", t => {
  const report = scan(t, [
    "require('./prefix' + name);",
    "import('./prefix' /* suffix follows */ + ext);",
    "require.resolve(`./prefix${name}`);",
    "import(`./prefix${import('./real.mjs')}`);",
  ].join("\n"));
  assert.deepEqual(report.findings.map(f => [f.code, f.line, f.message]), [
    ["broken-relative-import", 4, "Relative import does not resolve: ./real.mjs"],
  ]);
});

for (const count of [24, 25, 31]) {
  test(`show the first 24 of ${count} broken imports and disclose actual overflow`, t => {
    const missing = Array.from({ length: count }, (_, i) => `require('./missing-${i}');`);
    const source = [
      ...missing.slice(0, 24), "// require('./comment');", "require('./present.js');",
      "const sample = \"require('./string')\";", "require('./prefix' + name);",
    ];
    const report = scan(t, source.join("\n"), {
      "present.js": "", "z.mjs": missing.slice(24).join("\n"),
    });
    assert.equal(report.summary.confirmed, 24);
    assert.deepEqual(report.findings.map(f => f.message), missing.slice(0, 24).map((_, i) => `Relative import does not resolve: ./missing-${i}`));
    assert.deepEqual(report.notices, count === 24 ? [] : [
      { code: "broken-import-limit", actionable: false, message: "Showing 24 broken relative imports. More exist." },
    ]);
  });
}

test("escaped characters name literal files in both existing and new import forms", t => {
  const source = [
    String.raw`require('./don\'t.js');`,
    String.raw`import "./\u0061.mjs";`,
    "import(`./\\${literal}.mjs`);",
    String.raw`require.resolve('\x2e/foo.js');`,
  ].join("\n");
  const targets = ["don't.js", "a.mjs", "${literal}.mjs", "foo.js"];
  const spellings = [String.raw`./don\'t.js`, String.raw`./\u0061.mjs`, "./\\${literal}.mjs", String.raw`\x2e/foo.js`];
  assert.deepEqual(scan(t, source).findings.map(f => f.message), spellings.map(s => `Relative import does not resolve: ${s}`));
  assert.deepEqual(scan(t, source, Object.fromEntries(targets.map(t => [t, ""]))).findings, []);
});
