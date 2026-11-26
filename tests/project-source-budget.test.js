"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");

function project(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return root;
}

function checkUnread(report, message) {
  const findings = report.findings.filter(f => f.code === "source-not-read");
  assert.deepEqual(findings.map(f => [f.file, f.severity, f.confidence, f.message]),
    message ? [[".", "medium", "recommendation", message]] : []);
  if (message) assert.notEqual(report.status, "Healthy");
}

for (const bytes of [100, 1]) {
  test("source receives the byte budget before a " + bytes + "-byte root README", t => {
    const root = project(t, { "README.md": "x".repeat(bytes), "src/app.js": "eval(x);" });
    const report = auditProject({ path: root, limits: { maxTotalBytes: 100 } });
    assert.equal(report.status, "Needs attention");
    assert.ok(report.findings.some(f => f.code === "dynamic-code-execution"));
    assert.equal(report.findings.some(f => f.code === "scan-limit"), bytes === 100);
    checkUnread(report);
  });
}

test("nested source precedes manifests, tests and documents in the evidence budget", t => {
  const root = project(t, { "package.json": '{"scripts":{"test":"test"}}', "README.md": "docs",
    "tests/a.js": "test", "deep/lib/z.ts": "eval(x);" });
  const report = auditProject({ path: root, limits: { maxTotalBytes: 8 } });
  assert.ok(report.findings.some(f => f.code === "dynamic-code-execution"));
  checkUnread(report);
});

test("a byte stop names every remaining source, even one small enough to fit by itself", t => {
  const root = project(t, { "a.js": " ".repeat(120000), "b.js": " ".repeat(120000), "z.js": "eval(x);" });
  const report = auditProject({ path: root, limits: { maxTotalBytes: 200000 } });
  checkUnread(report, "2 JavaScript or TypeScript source files were not read: b.js, z.js");
  assert.ok(report.findings.some(f => f.message === "Stopped at the 200000-byte text bound."));
  checkUnread(auditProject({ path: root }));
});

test("size skips name only eligible sources and show the first five paths in order", t => {
  const files = { "tests/t.js": "long", "fixtures/f.ts": "long", "image.js": Buffer.from([0]), "README.md": "" };
  for (const name of ["g","b","f","a","e","c","d"]) files[name + ".ts"] = "long";
  const root = project(t, files);
  checkUnread(auditProject({ path: root, limits: { maxFileBytes: 3 } }),
    "7 JavaScript or TypeScript source files were not read: a.ts, b.ts, c.ts, d.ts, e.ts and 2 more");
  checkUnread(auditProject({ path: root }));
});

test("a file-count stop names remaining source in a subfolder", t => {
  const root = project(t, { "a.js": "", "src/z.js": "eval(x);", "tests/a.js": "" });
  checkUnread(auditProject({ path: root, limits: { maxFiles: 1 } }),
    "1 JavaScript or TypeScript source file was not read: src/z.js");
  checkUnread(auditProject({ path: root }));
});

test("a deadline after one source read names the remaining inventoried source", t => {
  const root = project(t, { "a.js": " ", "z.ts": "eval(x);", "tests/t.js": "" });
  const read = fs.readSync;
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(fs, "readSync", (...args) => {
    const count = read(...args);
    now += 51;
    return count;
  });
  checkUnread(auditProject({ path: root, limits: { maxDurationMs: 50 } }),
    "1 JavaScript or TypeScript source file was not read: z.ts");
});

test("the root listing retains known unread source names when the deadline expires during the listing", t => {
  const root = project(t, { "a.ts": "void 0;", "z.js": "void 0;" });
  const list = fs.readdirSync;
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(fs, "readdirSync", (...args) => {
    const entries = list(...args);
    now += 51;
    return entries;
  });
  const r = auditProject({ path: root, limits: { maxDurationMs: 50 } });
  checkUnread(r, "2 JavaScript or TypeScript source files were not read: a.ts, z.js");
  assert.equal(r.totalBytes, 0);
});

test("the open file size controls the limits if a source grew since inventory", t => {
  const root = project(t, { "a.js": " ".repeat(80) });
  const stat = fs.lstatSync;
  let inventoried = false;
  t.mock.method(fs, "lstatSync", (name, ...args) => {
    const result = stat(name, ...args);
    if (!inventoried && path.basename(name) === "a.js") {
      inventoried = true;
      result.size = 5;
    }
    return result;
  });
  const report = auditProject({ path: root, limits: { maxFileBytes: 8, maxTotalBytes: 12 } });
  assert.ok(inventoried);
  assert.equal(report.totalBytes, 0);
  checkUnread(report, "1 JavaScript or TypeScript source file was not read: a.js");
  assert.ok(report.notices.some(n => n.code === "oversized-text"));
});

test("the collector checks the deadline after inspecting an open file and before reading bytes", t => {
  const root = project(t, { "a.js": "void 0;" });
  const stat = fs.fstatSync;
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(fs, "fstatSync", (...args) => {
    const result = stat(...args);
    now += 51;
    return result;
  });
  const r = auditProject({ path: root, limits: { maxDurationMs: 50 } });
  checkUnread(r, "1 JavaScript or TypeScript source file was not read: a.js");
  assert.equal(r.totalBytes, 0);
});

test("a source that grows during a bounded read is not analyzed as a complete file", t => {
  const root = project(t, { "a.js": "eval(x);" });
  const read = fs.readSync;
  let sourceRead = false;
  t.mock.method(fs, "readSync", (...args) => {
    const count = read(...args);
    if (!sourceRead) fs.appendFileSync(path.join(root, "a.js"), " ".repeat(100));
    sourceRead = true;
    return count;
  });
  const r = auditProject({ path: root, limits: { maxFileBytes: 8, maxTotalBytes: 8 } });
  assert.ok(sourceRead);
  assert.equal(r.totalBytes, 8);
  assert.ok(r.notices.some(n => n.code === "unreadable-file" && n.message.includes("a.js")));
  assert.ok(!r.findings.some(f => f.code === "dynamic-code-execution"));
  assert.notEqual(r.status, "Healthy");
});

test("a file disappearing after directory listing is not reported as a limit skip", t => {
  const root = project(t, { "README.md": "", "race.js": "" });
  const stat = fs.lstatSync;
  t.mock.method(fs, "lstatSync", (name, ...args) => {
    if (path.basename(name) === "race.js") throw Object.assign(new Error("gone"), { code: "ENOENT" });
    return stat(name, ...args);
  });
  const report = auditProject({ path: root });
  assert.ok(!report.findings.some(f => f.code === "scan-limit"));
  checkUnread(report);
});
