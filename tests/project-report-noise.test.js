"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { auditProject, humanReport } = require("../skills/audit-project-health/scripts/audit-project");

function project(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-report-noise-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

test("skipped documents and extensionless binary data appear once in the terminal and only as notices", t => {
  const root = project(t, {
    "docs/preview.html": "x".repeat(600 * 1024),
    data_2: Buffer.alloc(600 * 1024),
    "README.md": "ready",
  });
  const report = auditProject({ projectPath: root });
  for (const name of ["docs/preview.html", "data_2"]) {
    assert.equal(humanReport(report).split(name).length - 1, 1, name);
    assert.equal(report.findings.some(f => f.file === name || f.message.includes(name)), false);
  }
  assert.ok(report.notices.some(n => n.code === "oversized-text" && n.message.includes("docs/preview.html")));
  assert.ok(report.notices.some(n => /binary/.test(n.code) && n.message.includes("data_2")));
  assert.equal(report.status, "Healthy");
});

test("extensionless oversize text and late NUL use the 8000-byte binary boundary", t => {
  const data = Buffer.alloc(10000, "x");
  data[7999] = 0;
  const late = Buffer.alloc(10000, "x");
  late[8000] = 0;
  const root = project(t, { binary: data, text: late, ordinary: "small" });
  const report = auditProject({ projectPath: root, limits: { maxFileBytes: 9000 } });
  assert.ok(report.notices.some(n => /binary/.test(n.code) && n.message.includes("binary")));
  assert.ok(report.notices.some(n => n.code === "oversized-text" && n.message.includes("text") && !n.message.includes("binary")));
  assert.equal(report.notices.some(n => n.message.includes("ordinary")), false);
});

test("3000 broken links respect the file bound and fit in one ten-example notice", { skip: process.platform === "win32" }, t => {
  const root = project(t);
  const name = i => "link-" + String(i).padStart(4, "0");
  for (let i = 0; i < 3000; i++) fs.symlinkSync("absent", path.join(root, name(i)));
  const report = auditProject({ projectPath: root, limits: { maxDurationMs: 60000 } });
  const notices = report.notices.filter(n => n.code === "symlink-unresolved");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].count, 2400);
  assert.ok(notices[0].message.includes("2400"));
  for (let i = 0; i < 10; i++) assert.ok(notices[0].message.includes(name(i)));
  assert.equal(notices[0].message.includes(name(10)), false);
  assert.ok(report.findings.some(f => f.code === "scan-limit" && f.message.includes("2400-file")));
  assert.equal(report.findings.some(f => f.code === "symlink-unresolved"), false);
  const jsonBytes = Buffer.byteLength(JSON.stringify(report, null, 2));
  const lines = humanReport(report).split("\n").length;
  assert.ok(jsonBytes < 100000, String(jsonBytes));
  assert.ok(lines < 100, String(lines));
  t.diagnostic(jsonBytes + " JSON bytes; " + lines + " terminal lines");
});

test("a lone broken link keeps its path and reason and a valid internal link stays a distinct notice", { skip: process.platform === "win32" }, t => {
  const root = project(t, { "README.md": "" });
  fs.symlinkSync("missing", path.join(root, "broken"));
  fs.symlinkSync("README.md", path.join(root, "internal"));
  const report = auditProject({ projectPath: root });
  assert.deepEqual(report.findings, []);
  assert.ok(report.notices.some(n => n.message === "Skipped unresolved symlink (ENOENT): broken"));
  assert.ok(report.notices.some(n => n.message === "Skipped symlink: internal"));
});

test("terminal groups equal codes, retains every high group and puts unread sources next", t => {
  const root = project(t, { "README.md": "" });
  const report = auditProject({ projectPath: root });
  function finding(code, severity, index = 0) {
    return { code, severity, confidence: "recommendation", category: "coverage", message: code + " example " + index,
      file: "source" + index, line: 1, impact: "Impact", verify: "Verify", recommendation: "Address " + code };
  }
  const highs = Array.from({ length: 10 }, (_, i) => finding("high-" + i, "high"));
  report.findings = [finding("low", "low"), ...highs, finding("high-0", "high", 1), finding("source-not-read", "medium")];
  const rendered = humanReport(report);
  for (const f of highs) {
    assert.ok(rendered.includes(f.message));
    assert.ok(rendered.indexOf(f.message) < rendered.indexOf("source-not-read example 0"));
  }
  assert.ok(rendered.includes("×2"));
  assert.ok(rendered.includes("Address high-0"));
  assert.ok(!rendered.includes("high-0 example 1"));
  assert.ok(rendered.includes("source-not-read example 0"));
  assert.match(rendered, /1 finding not shown/);
  assert.equal(report.findings.length, 13);
});

test("remaining bytes can prove an oversized extensionless file is binary without assuming partial text", t => {
  for (const isBinary of [true, false]) {
    const contents = Buffer.alloc(9000, "x");
    if (isBinary) contents[1] = 0;
    const root = project(t, { data: contents });
    const report = auditProject({ path: root, limits: { maxFileBytes: 6, maxTotalBytes: 12 } });
    assert.equal(report.totalBytes, 12);
    const notices = report.notices.filter(n => n.message.includes("data"));
    assert.equal(notices.length, 1);
    if (isBinary) assert.equal(notices[0].code, "binary-source-skipped");
    else {
      assert.ok(report.notices.some(n => n.code === "scan-limit"));
      assert.notEqual(notices[0].classification, "unclassified-text");
    }
  }
});
