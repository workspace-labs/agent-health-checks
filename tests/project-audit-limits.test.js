"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const checker = require.resolve("../skills/audit-project-health/scripts/audit-project");
const { auditProject } = require(checker);

function project(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "audit-time-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ "README.md": "", ...files })) {
    const dest = path.join(root, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, value);
  }
  return root;
}

function clockOnListing(t, directory, delay) {
  let clock = 1000;
  t.mock.method(Date, "now", () => clock);
  const read = fs.readdirSync;
  t.mock.method(fs, "readdirSync", (dir, ...args) => {
    const entries = read(dir, ...args);
    if (dir === directory) clock += delay;
    return entries;
  });
}

test("a time stop during traversal cannot call an existing web manifest missing", t => {
  const root = project(t, {
    "package.json": JSON.stringify({ dependencies: { workbox: "1" }, scripts: { test: "node --test" } }),
    "yarn.lock": "", "public/manifest.json": "{}", "public/sw.js": "",
  });
  assert.deepEqual(auditProject({ path: root }).findings, []);
  const fileStop = auditProject({ path: root, limits: { maxFiles: 1 } });
  assert.deepEqual(fileStop.findings.map(f => f.code), ["source-not-read", "scan-limit"]);
  assert.ok(fileStop.findings[0].message.includes("public/sw.js"));
  clockOnListing(t, path.join(root, "public"), 51);
  const report = auditProject({ path: root, limits: { maxDurationMs: 50 } });
  assert.ok(report.notices.some(n => n.message === "Stopped after the 50ms time bound."));
  assert.deepEqual(report.findings.map(f => f.code), ["source-not-read", "scan-limit"]);
});

for (const [delay, expected] of [[12, []], [51, ["scan-limit"]]]) {
  test("metadata checks after collection contribute " + delay + "ms to duration and the shared deadline", t => {
    const root = project(t, {
      "package.json": JSON.stringify({ main: "dist/app.js", scripts: { test: "node --test" } }),
      "dist/app.js": "",
      "last.js": delay > 50 ? "require('./absent');" : "",
    });
    clockOnListing(t, path.join(root, "dist"), delay);
    const report = auditProject({ path: root, limits: { maxDurationMs: 50 } });
    assert.deepEqual(report.findings.map(f => f.code), expected);
    assert.equal(report.durationMs, delay);
  });
}

test("deep package metadata returns one plain diagnostic and an ordinary package still works", t => {
  const root = project(t, { "main.js": "", "package.json": '{"main":"main.js","scripts":{"test":"node --test"}}' });
  assert.deepEqual(auditProject({ path: root }).findings, []);
  const depth = 20000;
  const contents = '{"main":"main.js","scripts":{"test":' + "[".repeat(depth) + "0" + "]".repeat(depth) + "}}";
  fs.writeFileSync(path.join(root, "package.json"), contents);
  const report = auditProject({ path: root });
  assert.equal([...report.findings, ...report.notices].filter(item => item.code === "package-not-examined").length, 1);
  assert.deepEqual(report.findings.map(f => [f.code, f.message]), [
    ["package-not-examined", "The root package.json was not examined because its nesting exceeds 256 levels."],
  ]);
});

test("unexpected errors reading package metadata produce a plain diagnostic", t => {
  const root = project(t, { "package.json": '{"name":"example","scripts":{"test":"node --test"}}' });
  const parse = JSON.parse;
  t.mock.method(JSON, "parse", (source, ...args) => {
    if (source.includes('"example"')) throw new RangeError("internal parser error");
    return parse(source, ...args);
  });
  const report = auditProject({ path: root });
  assert.equal([...report.findings, ...report.notices].filter(item => item.code === "package-not-examined").length, 1);
  assert.deepEqual(report.findings.map(f => [f.code, f.message]), [
    ["package-not-examined", "The root package.json was not examined because its metadata could not be processed."],
  ]);
});

for (const [label, prefix] of [
  ["empty catch", "catch"], ["TODO", "// TODO"], ["debug", "debugger"],
  ["dynamic code", "new Function"], ["Electron", "webPreferences: { contextIsolation"],
  ["import control", "from"],
]) {
  test("512 KiB " + label + " input finishes within one second", t => {
    const root = project(t, {
      "app.js": prefix.padEnd(512 * 1024),
      "package.json": JSON.stringify({ devDependencies: { electron: "1" }, scripts: { test: "node --test" } }),
      "yarn.lock": "",
    });
    // A process boundary also bounds a regression on a synchronous rule.
    const start = performance.now();
    const child = spawnSync(process.execPath, [checker, "--path", root, "--json"], { encoding: "utf8", timeout: 1000 });
    const elapsed = performance.now() - start;
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.ok(report.totalBytes >= 512 * 1024);
    assert.deepEqual(report.findings, []);
    assert.ok(elapsed < 1000, String(elapsed));
    t.diagnostic(label + " audit " + report.durationMs + " ms; including CLI " + elapsed.toFixed(1) + " ms");
  });
}

test("a deadline reached while preparing finding IDs discards absences and keeps positive evidence", t => {
  const root = project(t, { ".env": "fixture", "package.json": "{}" });
  let clock = 1000;
  const stringify = JSON.stringify;
  t.mock.method(Date, "now", () => clock);
  t.mock.method(JSON, "stringify", (value, ...rest) => {
    if (value?.reportDigest && value.code === "missing-test-script") clock = 1075;
    return stringify(value, ...rest);
  });
  const report = auditProject({ path: root, limits: { maxDurationMs: 50 } });
  assert.deepEqual(report.findings.map(f => f.code), ["secret-files-present", "scan-limit"]);
  assert.equal(report.notices.filter(n => n.code === "scan-limit").length, 1);
  assert.deepEqual(report.summary, { confirmed: 0, likely: 1, recommendation: 1, high: 1, findings: 2 });
  assert.equal(report.durationMs, 75);
});

test("an unexamined deep manifest cannot classify hand-written code as generated output", t => {
  const root = project(t, {
    "package.json": '{"dependencies":{"electron":"1"},"build":{"directories":{"output":"release"}},"deep":' +
      "[".repeat(300) + "0" + "]".repeat(300) + "}",
    "release/app.js": "require('./absent');",
  });
  const report = auditProject({ path: root });
  assert.deepEqual(report.findings.map(f => f.code), ["broken-relative-import", "package-not-examined"]);
});

test("a deep directory manifest leaves its import unverified", t => {
  const root = project(t, {
    "app.js": "require('./lib');",
    "lib/entry.js": "",
    "lib/package.json": '{"main":"entry.js","deep":' + "[".repeat(300) + "0" + "]".repeat(300) + "}",
  });
  const report = auditProject({ path: root });
  assert.deepEqual(report.findings, []);
  assert.ok(report.notices.some(n => n.code === "import-not-checked"));
});

test("a metadata probe stops before the next disk read after its deadline", t => {
  const root = project(t, {
    "package.json": JSON.stringify({ main: "dist/sub/app.js", scripts: { test: "node --test" } }),
    "dist/sub/app.js": "",
  });
  const base = path.join(root, "dist");
  const read = fs.readdirSync;
  let clock = 1000;
  const afterExpiry = [];
  t.mock.method(Date, "now", () => clock);
  t.mock.method(fs, "readdirSync", (dir, ...args) => {
    if (clock > 1050) afterExpiry.push(dir);
    if (dir === base) clock = 1060;
    return read(dir, ...args);
  });
  const report = auditProject({ path: root, limits: { maxDurationMs: 50 } });
  assert.deepEqual(report.findings.map(f => f.code), ["scan-limit"]);
  assert.deepEqual(afterExpiry, []);
});
