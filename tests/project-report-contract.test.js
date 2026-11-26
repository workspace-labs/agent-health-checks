"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const script = require.resolve("../skills/audit-project-health/scripts/audit-project.js");
const checker = require(script);

const reportKeys = [
  "schemaVersion", "checkerVersion", "readOnly", "projectId", "projectName", "root",
  "digest", "status", "statusKey", "stack", "summary", "findings", "notices", "limits",
  "fileCount", "totalBytes", "durationMs", "disclaimer",
];
const findingKeys = [
  "code", "category", "severity", "confidence", "message", "file", "line",
  "impact", "verify", "recommendation", "id",
];

function projectDirectory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function checkKeys(object, keys) {
  assert.deepEqual(Object.keys(object).sort(), [...keys].sort());
}

function checkSchema(report) {
  checkKeys(report, reportKeys);
  assert.equal(report.schemaVersion, 1);
  assert.match(report.checkerVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(report.readOnly, true);
  assert.match(report.digest, /^[a-f0-9]{64}$/);
  checkKeys(report.summary, ["findings", "confirmed", "likely", "recommendation", "high"]);
  checkKeys(report.limits, ["maxFiles", "maxFileBytes", "maxTotalBytes", "maxDurationMs"]);
  for (const finding of report.findings) {
    checkKeys(finding, findingKeys);
    assert.match(finding.id, /^[a-f0-9]{24}$/);
  }
}

function cliReport(root, expectedExit = 0) {
  const result = spawnSync(process.execPath, [script, "--path", root, "--json"], { encoding: "utf8" });
  assert.equal(result.status, expectedExit, result.stderr);
  return JSON.parse(result.stdout);
}

test("project checker exports the synchronous report and lookup APIs", () => {
  const functions = ["auditProject", "collectProject", "humanReport", "isIntentionalReferenceData", "resolveFinding"];
  checkKeys(checker, ["DEFAULT_LIMITS", ...functions]);
  for (const name of functions) assert.equal(typeof checker[name], "function", name);
});

test("project evidence retains its field names, severity, confidence, wording, digest and IDs", (t) => {
  const root = projectDirectory(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.js"), "// fixture\nrequire('./missing');\ntry { work(); } catch {}\n");
  const report = checker.auditProject({ projectPath: root });
  checkSchema(report);
  assert.deepEqual([report.statusKey, report.status], ["attention", "Needs attention"]);
  assert.deepEqual(report.summary, { findings: 3, confirmed: 1, likely: 1, recommendation: 1, high: 1 });
  assert.equal(report.digest, "25a507eb404b02abf345b796076f302414ebf17295ba396a3232a2caf244e97e");
  assert.deepEqual(report.findings.map(({ severity, confidence, code, message, file, line, id }) =>
    [severity, confidence, code, message, file, line, id]), [
    ["high", "confirmed", "broken-relative-import", "Relative import does not resolve: ./missing", "src/index.js", 2, "a37250e7b0ef9bede77d50bc"],
    ["medium", "likely", "empty-catch", "1 empty catch block suppresses errors without evidence.", "src/index.js", 3, "ffa1be8707ec014ff46be4c2"],
    ["low", "recommendation", "missing-readme", "No root README.md was found.", ".", 1, "468754def70a70fa9389c421"],
  ]);

  const finding = report.findings[0];
  assert.deepEqual(checker.resolveFinding(report, { digest: report.digest, findingId: finding.id }), { report, finding });
  assert.equal(checker.resolveFinding(report, { digest: "0".repeat(64), findingId: finding.id }), null);
  assert.equal(checker.resolveFinding(report, { digest: report.digest, findingId: "0".repeat(24) }), null);
  const cli = cliReport(root, 2);
  checkSchema(cli);
  assert.deepEqual(cli.findings, report.findings);
});

test("project checker reserves critical severity above high", () => {
  // No current rule emits a critical finding. Its reserved rank is only visible in the implementation.
  const ranking = fs.readFileSync(script, "utf8").match(/const severityRank\s*=\s*\{([^}]*)\}/);
  assert.ok(ranking, "expected the severity ranking");
  const ranks = Object.fromEntries([...ranking[1].matchAll(/(\w+)\s*:\s*(\d+)/g)].map(([, name, rank]) => [name, Number(rank)]));
  assert.deepEqual(ranks, { critical: 0, high: 1, medium: 2, low: 3 });
});

test("project CLI returns zero for Healthy and Watch, and one for an unavailable or omitted path", (t) => {
  const root = projectDirectory(t);
  const watch = cliReport(root);
  assert.deepEqual([watch.statusKey, watch.status], ["watch", "Watch"]);
  fs.writeFileSync(path.join(root, "README.md"), "# Example\n");
  const healthy = cliReport(root);
  assert.deepEqual([healthy.statusKey, healthy.status], ["healthy", "Healthy"]);

  // An ordinary file yields a portable error string for the unavailable-root digest.
  const file = path.join(root, "README.md");
  const unavailable = cliReport(file, 1);
  checkSchema(unavailable);
  const digest = createHash("sha256").update(`unavailable:${file}:Target is not a directory`).digest("hex");
  assert.equal(unavailable.digest, digest);
  assert.deepEqual([unavailable.statusKey, unavailable.status], ["unavailable", "Unavailable"]);
  assert.deepEqual(unavailable.stack, ["Unknown"]);
  assert.deepEqual(unavailable.summary, { findings: 1, confirmed: 1, likely: 0, recommendation: 0, high: 1 });
  assert.equal(unavailable.findings[0].code, "project-unavailable");
  assert.equal(unavailable.findings[0].message, "Project root is unavailable: Target is not a directory");
  const expectedFields = {
    code: "project-unavailable", category: "structure", severity: "high", confidence: "confirmed",
    message: "Project root is unavailable: Target is not a directory", file: ".", line: 1,
    impact: "The checker cannot inspect or verify this folder.",
    verify: "Check that --path names an existing folder you can read.",
    recommendation: "Correct the project path or restore access, then scan again.",
  };
  const expectedId = createHash("sha256").update(JSON.stringify({ reportDigest: digest, ...expectedFields }))
    .digest("hex").slice(0, 24);
  assert.deepEqual(unavailable.findings[0], { ...expectedFields, id: expectedId });
  const missing = spawnSync(process.execPath, [script, "--json"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr.trim(), /^--path is required[^\n]*\nUsage: [^\n]+$/);
});

test("project digest covers sorted paths, content hashes and size markers", (t) => {
  const root = projectDirectory(t);
  fs.writeFileSync(path.join(root, "d.txt"), "12345");
  fs.writeFileSync(path.join(root, "c.pem"), "1234");
  fs.writeFileSync(path.join(root, "b.png"), "123");
  fs.writeFileSync(path.join(root, "a.js"), "ok");
  const report = checker.auditProject({ projectPath: root, limits: { maxFileBytes: 4 } });
  assert.equal(report.fileCount, 4);
  assert.equal(report.totalBytes, 2);
  assert.equal(report.digest, "c5bfd0ba5a0db5ff7c56daf4e045f264f883e754fad3e589b530f925a0dde9db");
});
