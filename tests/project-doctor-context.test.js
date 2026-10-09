"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");

function project(t, pkg = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, "README.md", "# Fixture\n");
  put(root, "package.json", JSON.stringify({ scripts: { test: "node --test" }, ...pkg }));
  put(root, "package-lock.json", "{}\n");
  return root;
}

function put(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

const logs = "console.log('tool output');\n".repeat(4);
const electron = { devDependencies: { electron: "30.0.0" }, build: { files: ["electron/**/*", "dist/**/*", "package.json"] } };
const residue = (report) => report.findings.filter((finding) => finding.code === "debug-residue");

test("explicitly unpackaged Electron scripts disclose intentional console output", (t) => {
  const root = project(t, electron);
  put(root, "scripts/check.cjs", logs);
  const report = auditProject({ projectPath: root });
  assert.deepEqual(residue(report), []);
  assert.ok(report.notices.some((notice) => notice.code === "tooling-console-output" && notice.actionable === false));
});

for (const [name, pkg] of [
  ["no explicit package allowlist", { devDependencies: electron.devDependencies }],
  ["script is packaged", { ...electron, build: { files: ["scripts/**/*"] } }],
  ["unrecognized package pattern", { ...electron, build: { files: ["{electron,scripts}/**/*"] } }],
  ["no Electron provenance", { build: electron.build }],
  ["script is the app entry", { ...electron, main: "scripts/check.cjs" }],
]) {
  test(`tool console output remains actionable when ${name}`, (t) => {
    const root = project(t, pkg);
    put(root, "scripts/check.cjs", logs);
    assert.equal(residue(auditProject({ projectPath: root })).length, 1);
  });
}

test("ordinary source and scripts-lookalike paths retain console detection", (t) => {
  const root = project(t, electron);
  put(root, "src/app.js", logs);
  put(root, "scripts-old/app.js", logs);
  const report = auditProject({ projectPath: root });
  assert.equal(residue(report)[0].message, "8 debugger or console.log statements remain in source files.");
});

test("unpackaged tooling still reports executable debugger, missing imports and risky evaluation", (t) => {
  const root = project(t, electron);
  put(root, "scripts/check.cjs", logs + "debugger;\n".repeat(4) + "require('./missing.cjs');\neval(input);\n");
  const report = auditProject({ projectPath: root });
  assert.equal(residue(report)[0].message, "4 debugger or console.log statements remain in source files.");
  assert.ok(report.findings.some((finding) => finding.code === "broken-relative-import"));
  assert.ok(report.findings.some((finding) => finding.code === "dynamic-code-execution"));
});

test("ordinary in-project links stay visible without duplicating findings from their target", { skip: process.platform === "win32" }, (t) => {
  const root = project(t);
  put(root, "src/app.js", "require('./missing.js');\n");
  fs.symlinkSync("src/app.js", path.join(root, "linked-app.js"));
  const report = auditProject({ projectPath: root });
  assert.ok(report.notices.some((notice) => notice.classification === "in-project-symlink" && notice.actionable === false));
  assert.equal(report.findings.filter((finding) => finding.code === "broken-relative-import").length, 1);
  assert.equal(report.findings.some((finding) => finding.code === "symlink-skipped"), false);
});

for (const extension of ["js", "ts"]) {
  test(`${extension} import resolution checks the case of parent folders too`, (t) => {
    const root = project(t);
    put(root, `src/main.${extension}`, "import value from './library/item.js';\n");
    put(root, `src/Library/item.${extension}`, "export default 1;\n");
    const report = auditProject({ projectPath: root });
    assert.ok(report.findings.some((finding) => finding.code === "broken-relative-import" && finding.file === `src/main.${extension}`));
  });
}

test("many backup summaries cannot bypass the cumulative metadata read limit", (t) => {
  const root = project(t, { dependencies: { "@capacitor/core": "8", "@capacitor/android": "8" } });
  put(root, "capacitor.config.json", JSON.stringify({ appId: "com.example.app" }));
  for (let i = 0; i < 20; i++) {
    const rel = `.tablet-backup/snapshot-${i}`;
    put(root, `${rel}/summary.json`, JSON.stringify({ package: { id: "com.example.app" }, takenAt: "2026-09-15T12:00:00Z", copy: {}, padding: "x".repeat(600) }));
    put(root, `${rel}/apk/app.js`, "require('./missing.js');\n");
  }
  const report = auditProject({ projectPath: root, limits: { maxTotalBytes: 1024 } });
  assert.ok(report.findings.some((finding) => finding.code === "metadata-limit"));
  assert.ok(report.notices.filter((notice) => notice.classification === "verified-tablet-backup").length < 20);
});

for (const extension of ["apk", "aab", "tar"]) {
  test(`${extension} archives are binary while their large-file signal remains visible`, (t) => {
    const root = project(t);
    put(root, `saved/app.${extension}`, Buffer.alloc(1024 * 1024 + 1));
    const report = auditProject({ projectPath: root });
    assert.equal(report.findings.some((finding) => finding.code === "oversized-text"), false);
    assert.ok(report.findings.some((finding) => finding.code === "large-project-files"));
  });
}

test("an archive-looking source filename keeps the oversized-source warning", (t) => {
  const root = project(t);
  put(root, "src/app.apk.js", "x".repeat(1024 * 1024 + 1));
  const report = auditProject({ projectPath: root });
  assert.ok(report.findings.some((finding) => finding.code === "oversized-text"));
});
