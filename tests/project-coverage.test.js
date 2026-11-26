"use strict";

const { watchFileReads } = require("./support/project-reads");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditProject, humanReport } = require("../skills/audit-project-health/scripts/audit-project");

function project(t, files, { readme = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-coverage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, value] of Object.entries(readme ? { "README.md": "", ...files } : files)) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, value);
  }
  return root;
}

function boundary(report, code) {
  return report.notices.filter(n => n.code === code && n.actionable === false).map(n => n.message);
}

function checkCoverage(report, message) {
  assert.deepEqual(boundary(report, "code-coverage"), [message]);
  assert.ok(humanReport(report).includes(message));
}

for (const [rel, source, language] of [
  ["example.py", "import missing_module\neval(input())", "Python"],
  ["main.go", "package main\n" + "// TODO\n".repeat(40), "Go"],
  ["lib.rs", "mod missing;", "Rust"],
]) {
  test(language + " code on its own discloses a Watch coverage finding", t => {
    const report = auditProject({ path: project(t, { [rel]: source }) });
    assert.equal(report.statusKey, "watch");
    assert.deepEqual(report.findings.map(f => [f.code, f.severity, f.confidence, f.message]), [
      ["code-not-examined", "low", "recommendation", language + " code was not examined."],
    ]);
    checkCoverage(report, "Code rules examined 0 JavaScript/TypeScript files. Other languages seen but not examined: " + language + ".");
  });
}

test("clean JavaScript stays Healthy and lists the number of files examined", t => {
  const report = auditProject({ path: project(t, { "src/app.js": "export default 1;" }) });
  assert.equal(report.statusKey, "healthy");
  assert.equal(report.findings.length, 0);
  checkCoverage(report, "Code rules examined 1 JavaScript/TypeScript file. Other languages seen but not examined: none.");
});

test("mixed languages get one notice and no finding; source tests and samples do not count", t => {
  const report = auditProject({ profile: "workspace", path: project(t, {
    "src/app.js": "", "src/base.ts": "", "src/other.py": "", "src/more.py": "", "foo.go": "",
    "tests/app.js": "", "fixtures/test.ts": "", "src/demos/demo.ts": "",
  }) });
  assert.equal(report.findings.length, 0);
  checkCoverage(report, "Code rules examined 2 JavaScript/TypeScript files. Other languages seen but not examined: Go, Python.");
});

test("an empty project and an unavailable root disclose zero examined files", t => {
  const root = project(t, {});
  for (const target of [root, path.join(root, "absent")]) {
    const report = auditProject({ path: target });
    checkCoverage(report, "Code rules examined 0 JavaScript/TypeScript files. Other languages seen but not examined: none.");
  }
});

test("nested packages are named once, including unreadable and oversized manifests", t => {
  const root = project(t, {
    "package.json": '{"scripts":{"test":"node --test"}}',
    "packages/a/package.json": '{"main":"absent.js"}', "packages/b/package.json": "{",
    "packages/c/package.json": " ".repeat(512), "node_modules/pkg/package.json": "{}",
  });
  watchFileReads(t, file => {
    if (file.endsWith(path.join("b", "package.json"))) throw new Error("fixture");
  });
  const report = auditProject({ path: root, limits: { maxFileBytes: 128 } });
  assert.deepEqual(boundary(report, "nested-packages-not-judged"), [
    "Nested packages were not judged: packages/a/package.json, packages/b/package.json, packages/c/package.json.",
  ]);
  assert.equal(report.findings.some(f => f.code === "missing-package-entry"), false);
});

test("a clean root with one broken nested package stays Healthy with a package notice", t => {
  const root = project(t, { "package.json": '{"scripts":{"test":"node --test"}}', "packages/a/package.json": '{"main":"missing"}' });
  const report = auditProject({ path: root });
  assert.equal(report.statusKey, "healthy");
  assert.deepEqual(boundary(report, "nested-packages-not-judged"), ["Nested packages were not judged: packages/a/package.json."]);
  const solo = auditProject({ path: project(t, { "package.json": '{"scripts":{"test":"node --test"}}' }) });
  assert.deepEqual(boundary(solo, "nested-packages-not-judged"), []);
});

test("all top-level output names stay skipped; identically named source folders are checked", t => {
  const broken = "require('./missing');";
  const names = ["build", "coverage", "dist", "out", "target", "tmp", "vendor"];
  const files = { "src/control.js": broken };
  for (const name of names) {
    files[name + "/code.js"] = broken + "eval(value);";
    files["src/" + name + "/code.js"] = broken;
  }
  const report = auditProject({ path: project(t, files) });
  assert.deepEqual(report.findings.filter(f => f.code === "broken-relative-import").map(f => f.file).sort(),
    ["src/control.js", ...names.map(n => "src/" + n + "/code.js")].sort());
  assert.equal(report.findings.some(f => f.code === "dynamic-code-execution"), false);
  assert.deepEqual(boundary(report, "folders-not-judged"), ["Code rules excluded 7 folders: build, coverage, dist, out, target, tmp, vendor."]);
});

test("demos, skill templates, caches and nested dependencies are named together", t => {
  const folders = ["src/demos", "skills-library/foo/templates", "lib/.cache", "pkg/.git", "lib/node_modules"];
  const files = {};
  for (const name of [...folders, "tests", "fixtures"]) files[name + "/code.js"] = "require('./missing');";
  const report = auditProject({ profile: "workspace", path: project(t, files) });
  assert.equal(report.statusKey, "healthy");
  assert.deepEqual(boundary(report, "folders-not-judged"), ["Code rules excluded 5 folders: lib/.cache, lib/node_modules, pkg/.git, skills-library/foo/templates, src/demos."]);
});

for (const name of [".gitignore", ".git/info/exclude"]) {
  test(name + " literal root folders are excluded and ordinary source still counts", t => {
    const report = auditProject({ path: project(t, {
      [name]: "# local\n/scratch/\nold files/\n*.js\ninner/sub/\n",
      "scratch/app.js": "eval(value);", "old files/file.js": "eval(value);",
      "src/scratch/app.js": "require('./missing');", "inner/sub/app.js": "require('./missing');",
    }) });
    assert.deepEqual(report.findings.map(f => f.file), ["inner/sub/app.js", "src/scratch/app.js"]);
    assert.deepEqual(boundary(report, "git-ignored-folders"), ["Git ignore rules excluded 2 folders: old files, scratch."]);
  });
}

test("a negation disables only the ignore file containing it", t => {
  const report = auditProject({ path: project(t, {
    ".gitignore": "scratch/\n!scratch/keep.js\n", ".git/info/exclude": "extra/\n",
    "scratch/app.js": "eval(value);", "extra/app.js": "eval(value);",
  }) });
  assert.deepEqual(report.findings.filter(f => f.code === "dynamic-code-execution").map(f => f.message),
    ["1 dynamic code execution primitive was found."]);
  assert.deepEqual(boundary(report, "git-ignored-folders"), ["Git ignore rules excluded 1 folder: extra."]);
});

test("a symlinked info directory cannot supply ignore rules", { skip: process.platform === "win32" }, t => {
  const outside = project(t, { exclude: "scratch/\n" });
  const root = project(t, { ".git/HEAD": "", "scratch/app.js": "eval(value);" });
  fs.symlinkSync(outside, path.join(root, ".git", "info"), "dir");
  const report = auditProject({ path: root });
  assert.ok(report.findings.some(f => f.code === "dynamic-code-execution"));
  assert.deepEqual(boundary(report, "git-ignored-folders"), []);
});

for (const name of [".gitignore", ".git/info/exclude"]) {
  for (const [label, bytes] of [
    ["oversized", "scratch/\n" + "#".repeat(180)],
    ["invalid UTF-8", Buffer.concat([Buffer.from("scratch/\n"), Buffer.from([0xff])])],
  ]) {
    test(name + " with " + label + " contents cannot hide source", t => {
      const root = project(t, { [name]: bytes, "scratch/app.js": "eval(value);" });
      const report = auditProject({ path: root, limits: { maxFileBytes: 128 } });
      assert.ok(report.findings.some(f => f.code === "dynamic-code-execution"));
      assert.deepEqual(boundary(report, "git-ignored-folders"), []);
    });
  }
}

test("the metadata reader never opens files beneath a Git-ignored Android folder", t => {
  const generated = "android/app/src/main/assets/capacitor.config.json";
  const root = project(t, {
    ".gitignore": "android/\n",
    "package.json": '{"dependencies":{"@capacitor/android":"1","@capacitor/core":"1"},"scripts":{"test":"node --test"}}',
    "capacitor.config.json": '{"appId":"test.app"}', [generated]: '{"appId":"test.app"}',
  });
  const files = [];
  watchFileReads(t, file => files.push(file));
  const report = auditProject({ path: root });
  assert.ok(!files.some(file => file.endsWith(path.join(...generated.split("/")))));
  assert.deepEqual(boundary(report, "git-ignored-folders"), ["Git ignore rules excluded 1 folder: android."]);
});

test("a deadline spent listing the root prevents later metadata reads", t => {
  const root = project(t, { "package.json": '{"scripts":{"test":"node --test"}}' });
  const list = fs.readdirSync;
  const files = [];
  let clock = 0;
  t.mock.method(Date, "now", () => clock);
  t.mock.method(fs, "readdirSync", (...args) => {
    const entries = list(...args);
    clock = 20;
    return entries;
  });
  watchFileReads(t, file => files.push(file));
  const report = auditProject({ path: root, limits: { maxDurationMs: 10 } });
  assert.ok(report.notices.some(n => n.message === "Stopped after the 10ms time bound."));
  assert.deepEqual(files, []);
});

test("a byte stop keeps observed names for ignored, sample and skipped folders", t => {
  const root = project(t, {
    ".gitignore": "zzz-scratch/\n", "large/file.txt": "x".repeat(64),
    "zzz-scratch/app.js": "eval(value);", "vendor/app.js": "", "demos/item.js": "",
  });
  const report = auditProject({ profile: "workspace", path: root, limits: { maxTotalBytes: 32 } });
  assert.ok(report.notices.some(n => n.code === "scan-limit"));
  assert.deepEqual(boundary(report, "git-ignored-folders"), ["Git ignore rules excluded 1 folder: zzz-scratch."]);
  assert.deepEqual(boundary(report, "folders-not-judged"), ["Code rules excluded 2 folders: demos, vendor."]);
});

for (const readme of [false, true]) {
  test("a plain HTML and CSS site " + (readme ? "with" : "without") + " a README retains its documentation verdict", t => {
    const report = auditProject({ path: project(t, {
      "index.html": "<h1>Plain website</h1>", "style.css": "body { color: black; }",
    }, { readme }) });
    assert.equal(report.fileCount, readme ? 3 : 2);
    assert.equal(report.statusKey, readme ? "healthy" : "watch");
    assert.deepEqual(report.findings.map(f => [f.code, f.severity, f.confidence, f.message]), readme ? [] : [
      ["missing-readme", "low", "recommendation", "No root README.md was found."],
    ]);
    assert.equal(report.notices.length, 1);
    checkCoverage(report, "Code rules examined 0 JavaScript/TypeScript files. Other languages seen but not examined: CSS, HTML.");
  });
}

test("stylesheets and markup-only component templates have notices without findings", t => {
  const report = auditProject({ path: project(t, {
    "styles.sass": "body\n  color: black", "styles.scss": "body { color: black; }", "styles.less": ".site {}",
    "Page.vue": "<template><h1>Site</h1></template>", "Page.svelte": "<h1>Site</h1>", "Page.astro": "<h1>Site</h1>",
  }) });
  assert.deepEqual(report.findings, []);
  checkCoverage(report, "Code rules examined 0 JavaScript/TypeScript files. Other languages seen but not examined: Astro, Less, Sass, Svelte, Vue.");
});

test("a mixed static site names only programming languages in its coverage finding", t => {
  const report = auditProject({ path: project(t, {
    "index.html": "<h1>Page</h1>", "style.css": "h1 {}", "Page.vue": "<template><p>Site</p></template>",
    "generate.py": "print('site')", "serve.go": "package main",
  }) });
  assert.equal(report.statusKey, "watch");
  assert.deepEqual(report.findings.map(f => [f.code, f.message]), [
    ["code-not-examined", "Go, Python code was not examined."],
  ]);
  checkCoverage(report, "Code rules examined 0 JavaScript/TypeScript files. Other languages seen but not examined: CSS, Go, HTML, Python, Vue.");
});

test("a shell-only project still gets one Watch coverage finding", t => {
  const report = auditProject({ path: project(t, { "build.sh": "echo site" }) });
  assert.equal(report.statusKey, "watch");
  assert.deepEqual(report.findings.map(f => [f.code, f.message]), [
    ["code-not-examined", "Shell code was not examined."],
  ]);
  checkCoverage(report, "Code rules examined 0 JavaScript/TypeScript files. Other languages seen but not examined: Shell.");
});

test("only the workspace profile excludes owner layout", t => {
  const dirs = [
    ".backup-install", ".backup-pipeline", ".proof", ".proof-pipeline", ".trash",
    ".pipeline", "demos", "skills-library/x/templates",
  ];
  const generated = [".git", "node_modules", "vendor", "dist", "build", "out", "tmp", "coverage", "target"];
  const files = { "settings.bak": "settings", "settings.bak-2026": "old settings" };
  for (const dir of [...dirs, ...generated]) files[dir + "/app.js"] = "require('./missing');";
  files["demos/image.png"] = Buffer.alloc(1024 * 1024 + 1);
  const root = project(t, files);
  const generic = auditProject({ projectPath: root });
  assert.deepEqual(generic.findings.filter(f => f.code === "broken-relative-import").map(f => f.file).sort(),
    dirs.map(dir => dir + "/app.js").sort());
  assert.ok(generic.findings.some(f => f.code === "large-project-files" && f.file === "demos/image.png"));
  assert.equal(generic.fileCount, dirs.length + 4);
  assert.deepEqual(boundary(generic, "folders-not-judged"), [
    "Code rules excluded 9 folders: .git, build, coverage, dist, node_modules, out, target, tmp, vendor.",
  ]);
  assert.ok(!generic.notices.some(n => ["workspace-artifact-excluded", "non-production-large-asset"].includes(n.code)));

  const workspace = auditProject({ projectPath: root, profile: "workspace" });
  assert.equal(workspace.findings.length, 0);
  assert.ok(workspace.notices.some(n => n.code === "non-production-large-asset"));
  assert.ok(workspace.notices.some(n => n.code === "workspace-artifact-excluded"));
});
