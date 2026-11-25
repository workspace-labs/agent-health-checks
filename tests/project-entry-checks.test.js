"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");

function project(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "doctor-entry-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, contents] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return root;
}

function manifest(fields) {
  return JSON.stringify({ scripts: { test: "node --test" }, ...fields });
}

function notice(report, code) {
  return report.notices.filter(item => item.code === code).map(item => item.message);
}

for (const [entry, file] of [
  ["dist/index.js", "dist/index.js"], ["src/index", "src/index.js"],
  ["lib", "lib/index.js"], ["data", "data.json"], ["native", "native.node"],
  ["lib", "lib/index.json"], ["native", "native/index.node"], ["./bin/tool", "bin/tool"],
]) {
  test("main and bin resolve " + entry + " through " + file, t => {
    const root = project(t, { "README.md": "", "package.json": manifest({ main: entry, bin: entry }), [file]: "" });
    const report = auditProject({ projectPath: root });
    assert.deepEqual(report.findings, []);
    assert.deepEqual(notice(report, "package-entry-not-built"), []);
    assert.deepEqual(notice(report, "file-not-checked"), []);
  });
}

test("absent entries stay confirmed and bin object entries are checked individually", t => {
  const root = project(t, {
    "README.md": "", "package.json": manifest({ main: "src/gone.js", bin: { ok: "./lib", bad: "./bin/gone" } }),
    "lib/index.js": "",
  });
  const report = auditProject({ projectPath: root });
  assert.deepEqual(report.findings.map(f => [f.code, f.message, f.confidence, f.severity]).sort(), [
    ["missing-package-bin", "package.json declares a missing bin entry: bin/gone", "confirmed", "high"],
    ["missing-package-entry", "package.json declares a missing main entry: src/gone.js", "confirmed", "high"],
  ]);
});

for (const output of ["build", "out", "dist"]) {
  test("absent " + output + " is unbuilt, but an existing output with a missing entry is confirmed", t => {
    const entry = output + "/app.js";
    const root = project(t, { "README.md": "", "package.json": manifest({ main: entry, bin: entry }) });
    const before = auditProject({ projectPath: root });
    assert.deepEqual(before.findings, []);
    assert.deepEqual(notice(before, "package-entry-not-built"), ["main", "bin"].map(field =>
      "package.json " + field + " entry " + entry + ": not built yet, cannot confirm."));
    fs.mkdirSync(path.join(root, output));
    const after = auditProject({ projectPath: root });
    assert.deepEqual(after.findings.map(f => f.code).sort(), ["missing-package-bin", "missing-package-entry"]);
    assert.deepEqual(notice(after, "package-entry-not-built"), []);
  });
}

test("2,500 pictures cannot displace root metadata or hide a built dist entry", t => {
  const root = project(t, {
    "README.md": "", "package.json": manifest({ main: "dist/index.js" }), "dist/index.js": "",
    "src/helper.js": "require('./absent'); require('./present');", "src/present.js": "", "assets/0.png": "x",
  });
  for (let i = 1; i < 2500; i++) fs.writeFileSync(path.join(root, "assets", i + ".png"), "x");
  const start = performance.now();
  const report = auditProject({ projectPath: root });
  const elapsed = performance.now() - start;
  t.diagnostic("2,500-picture audit: " + elapsed.toFixed(1) + " ms");
  assert.ok(elapsed < 2000);
  assert.deepEqual(report.stack, ["JavaScript"]);
  assert.deepEqual(report.findings.map(f => f.code), ["broken-relative-import", "scan-limit"]);
  assert.equal(report.findings[0].message, "Relative import does not resolve: ./absent");
  assert.deepEqual(notice(report, "file-not-checked"), []);
  assert.deepEqual(notice(report, "package-entry-not-built"), []);
});

test("README, lockfile, a declared source entry and a worker beyond a one-file limit are found by name", t => {
  const root = project(t, {
    "README.md": "", "package.json": manifest({ dependencies: { workbox: "1" }, main: "src/start" }),
    "yarn.lock": "", "src/start.js": "", "public/sw.js": "", "public/manifest.json": "{}",
  });
  const report = auditProject({ projectPath: root, limits: { maxFiles: 1 } });
  assert.ok(report.stack.includes("PWA"), "package.json was scanned");
  assert.ok(report.notices.some(n => n.code === "scan-limit"));
  assert.deepEqual(report.findings.filter(f =>
    ["missing-readme", "missing-lockfile", "missing-package-entry", "pwa-missing-worker"].includes(f.code)), []);
  assert.deepEqual(notice(report, "file-not-checked"), []);
});

test("a bounded scan reports unchecked absences, and a complete scan reports the same files missing", t => {
  const root = project(t, {
    "package.json": manifest({ main: "src/gone.js", dependencies: { workbox: "1" } }),
    "z.txt": "",
  });
  const subjects = ["Root README.md", "Dependency lockfile", "package.json main entry src/gone.js", "Source service worker"];
  const limited = auditProject({ projectPath: root, limits: { maxFiles: 1 } });
  assert.deepEqual(notice(limited, "file-not-checked").sort(), subjects.map(subject =>
    subject + " was not checked because the scan was incomplete or the path could not be verified.").sort());
  const rules = ["missing-readme", "missing-lockfile", "missing-package-entry", "pwa-missing-worker"].sort();
  assert.deepEqual(limited.findings.filter(f => rules.includes(f.code) || f.code === "file-not-checked"), []);
  const complete = auditProject({ projectPath: root });
  assert.deepEqual(complete.findings.map(f => f.code).filter(code => rules.includes(code)).sort(), rules);
  assert.deepEqual(notice(complete, "file-not-checked"), []);
});

function denyListing(t, deniedPath) {
  const readdir = fs.readdirSync;
  t.mock.method(fs, "readdirSync", (dir, ...args) => {
    if (dir === deniedPath) throw Object.assign(new Error("fixture listing denied"), { code: "EACCES" });
    return readdir(dir, ...args);
  });
}

test("a project root that cannot be listed has the existing Unavailable report", t => {
  const root = project(t, { "README.md": "" });
  denyListing(t, root);
  const report = auditProject({ projectPath: root });
  assert.equal(report.status, "Unavailable");
  assert.deepEqual(report.findings.map(f => f.code), ["project-unavailable"]);
});

test("unreadable source folders cannot produce a missing entry or worker verdict", t => {
  const root = project(t, {
    "README.md": "", "package.json": manifest({ main: "closed/app", dependencies: { workbox: "1" } }),
    "yarn.lock": "", "closed/app.js": "", "closed/sw.js": "",
  });
  denyListing(t, path.join(root, "closed"));
  const report = auditProject({ projectPath: root });
  assert.deepEqual(report.findings.filter(f => ["missing-package-entry", "pwa-missing-worker"].includes(f.code)), []);
  assert.deepEqual(notice(report, "file-not-checked").sort(), ["Source service worker", "package.json main entry closed/app"].map(subject =>
    subject + " was not checked because the scan was incomplete or the path could not be verified.").sort());
});

test("file contents can be unreadable while README, lockfile, entry and worker names are still verified", t => {
  const files = ["README.md", "yarn.lock", "code/app.js", "nested/scripts/service-worker.ts"];
  const root = project(t, {
    "package.json": manifest({ main: "code/app.js", dependencies: { workbox: "1" } }),
    ...Object.fromEntries(files.map(name => [name, ""])),
  });
  const readFile = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (files.some(name => path.join(root, name) === file)) throw Object.assign(new Error("denied"), { code: "EACCES" });
    return readFile(file, ...args);
  });
  const report = auditProject({ projectPath: root });
  assert.deepEqual(report.findings.filter(f =>
    ["missing-readme", "missing-lockfile", "missing-package-entry", "pwa-missing-worker"].includes(f.code)), []);
  assert.deepEqual(notice(report, "file-not-checked"), []);
});

test("entry declarations outside the root are reported as unchecked", t => {
  const root = project(t, { "README.md": "" });
  const absolute = path.join(path.dirname(root), "external-tool.js");
  fs.writeFileSync(path.join(root, "package.json"), manifest({ main: "../external-main.js", bin: absolute }));
  const report = auditProject({ projectPath: root });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(notice(report, "file-not-checked"), ["main entry ../external-main.js", "bin entry " + absolute].map(entry =>
    "package.json " + entry + " was not checked because the scan was incomplete or the path could not be verified."));
});

test("links to external files and output directories cannot confirm missing main or bin",
  { skip: process.platform === "win32" }, t => {
    const outside = project(t, { "real.js": "" });
    const root = project(t, { "README.md": "", "package.json": manifest({ main: "dist/real.js", bin: "cli" }) });
    fs.symlinkSync(outside, path.join(root, "dist"));
    fs.symlinkSync(path.join(outside, "real.js"), path.join(root, "cli.js"));
    const report = auditProject({ projectPath: root });
    assert.deepEqual(report.findings.filter(f => f.code === "missing-package-bin" || f.code === "missing-package-entry"), []);
    assert.deepEqual(notice(report, "package-entry-not-built"), []);
    assert.deepEqual(notice(report, "file-not-checked"), ["main entry dist/real.js", "bin entry cli"].map(entry =>
      "package.json " + entry + " was not checked because the scan was incomplete or the path could not be verified."));
  });
