"use strict";

const { watchFileReads } = require("./support/project-reads");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");

const manifest = JSON.stringify({ main: "index.js", scripts: { test: "node --test" } });
const utf8Mark = Buffer.from([0xef, 0xbb, 0xbf]);
const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(manifest, "utf16le")]);

function project(t, files, limits) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, data] of Object.entries({ "README.md": "", "index.js": "", ...files })) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  return auditProject({ projectPath: root, limits });
}

for (const [name, value] of [["plain UTF-8", manifest], ["one leading UTF-8 BOM", Buffer.concat([utf8Mark, Buffer.from(manifest)])]]) {
  test(name + " preserves manifest checks and declared output exclusions", t => {
    const valid = project(t, { "package.json": value });
    assert.equal(valid.status, "Healthy");
    assert.deepEqual(valid.findings, []);
    const pkg = { dependencies: { electron: "1" }, scripts: { test: "node --test" }, build: { directories: { output: "release" } } };
    const bytes = Buffer.from(JSON.stringify(pkg));
    const report = project(t, {
      "package.json": name === "plain UTF-8" ? bytes : Buffer.concat([utf8Mark, bytes]),
      "release/sample.js": "require('./absent')",
    });
    assert.deepEqual(report.findings.map(item => item.code), ["missing-lockfile"]);
    assert.ok(report.notices.some(item => item.code === "project-artifact-excluded"));
  });
}

for (const [name, data, reason] of [
  ["empty", "", "the file is empty"],
  ["UTF-16 little-endian", utf16, "the file is UTF-16"],
  ["UTF-16 big-endian", Buffer.from([0xfe, 0xff, 0, 123, 0, 125]), "the file is UTF-16"],
  ["zero bytes without an encoding mark", Buffer.from(manifest, "utf16le"), "the file contains zero bytes"],
  ["invalid UTF-8 inside a JSON string", Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]), "the file contains invalid UTF-8"],
]) {
  test(name + " package.json names the read failure", t => {
    const report = project(t, { "package.json": data });
    assert.equal(report.status, "Needs attention");
    assert.deepEqual(report.findings.map(({ code, message, severity, confidence, file, line }) =>
      ({ code, message, severity, confidence, file, line })), [{
      code: "unreadable-package-json", message: "Cannot read package.json as UTF-8 JSON because " + reason + ".",
      severity: "high", confidence: "confirmed", file: "package.json", line: 1,
    }]);
  });
}

test("a second BOM and whitespace-only text retain the JSON parser finding", t => {
  for (const value of ["\uFEFF\uFEFF" + manifest, " \r\n"]) {
    const report = project(t, { "package.json": value });
    assert.deepEqual(report.findings.map(item => item.code), ["malformed-package-json"]);
  }
});

test("an oversized manifest retains its size notice", t => {
  const report = project(t, { "package.json": manifest }, { maxFileBytes: 10 });
  assert.deepEqual(report.findings, []);
  assert.ok(report.notices.some(n => n.code === "oversized-text" && n.message.includes("package.json")));
});

test("binary sources, manifests, images and fonts share a bounded notice", t => {
  const sources = ["a.js", "b.jsx", "c.mjs", "d.cjs", "e.ts", "f.tsx", "g.cts", "h.mts", "i.json", "j.webmanifest", "package.json"];
  const files = Object.fromEntries([...sources, "picture.png", "font.woff2"].map(name => [name, utf16]));
  const report = project(t, files);
  assert.equal(report.notices.length, 2);
  const binary = report.notices.find(n => n.code === "binary-source-skipped");
  assert.equal(binary.count, sources.length + 2);
  assert.ok(binary.message.includes("a.js"));
  assert.ok(report.notices.some(n => n.code === "code-coverage" &&
    n.message === "Code rules examined 1 JavaScript/TypeScript file. Other languages seen but not examined: none."));
});

test("the same source in plain UTF-8 is checked", t => {
  const report = project(t, { "index.js": "require('./missing');" });
  assert.deepEqual(report.findings.map(item => item.code), ["broken-relative-import"]);
  assert.deepEqual(report.notices, [{
    code: "code-coverage", message: "Code rules examined 1 JavaScript/TypeScript file. Other languages seen but not examined: none.", actionable: false,
  }]);
});

test("a UTF-16 source BOM discloses a skipped file even when no byte is zero", t => {
  const report = project(t, { "index.js": Buffer.from([0xff, 0xfe, 0x2d, 0x4e]) });
  assert.deepEqual(report.notices, [{
    code: "binary-source-skipped", message: "Skipped index.js because it looks binary.", actionable: false,
  }, {
    code: "code-coverage", message: "Code rules examined 0 JavaScript/TypeScript files. Other languages seen but not examined: none.", actionable: false,
  }]);
});

for (const [code, reason] of [["EACCES", "access was denied"], ["EIO", "the file read failed"]]) {
  test(code + " names the manifest read failure without claiming malformed JSON", t => {
    watchFileReads(t, name => {
      if (path.basename(name) === "package.json") throw Object.assign(new Error("fixture read failure"), { code });
    });
    const report = project(t, { "package.json": manifest });
    assert.equal(report.status, "Needs attention");
    assert.deepEqual(report.findings.filter(f => f.confidence === "confirmed").map(f =>
      [f.code, f.severity, f.file, f.message]), [["unreadable-package-json", "high", "package.json",
      "Cannot read package.json as UTF-8 JSON because " + reason + "."]]);
    assert.ok(report.notices.some(n => n.code === "unreadable-file"));
  });
}
