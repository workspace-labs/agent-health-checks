"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { auditProject, humanReport, resolveFinding } = require("../skills/audit-project-health/scripts/audit-project");

function temp(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `project-doctor-${label}-`)); }
function put(root, rel, value) {
  const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file;
}
function hashTree(root) {
  const digest = crypto.createHash("sha256");
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name); digest.update(path.relative(root, file));
      if (entry.isDirectory()) walk(file); else if (entry.isSymbolicLink()) digest.update(fs.readlinkSync(file)); else digest.update(fs.readFileSync(file));
    }
  }
  walk(root); return digest.digest("hex");
}

test("healthy generic project returns deterministic read-only evidence", () => {
  const root = temp("healthy");
  put(root, "README.md", "# Demo\n");
  put(root, "src/index.js", "export const value = 1;\n");
  const before = hashTree(root);
  const first = auditProject({ projectPath: root, projectId: "demo", projectName: "Demo" });
  const second = auditProject({ projectPath: root, projectId: "demo", projectName: "Demo" });
  assert.equal(first.readOnly, true);
  assert.equal(first.digest, second.digest);
  assert.equal(hashTree(root), before);
  assert.equal(first.status, "Healthy");
});

test("malformed package and broken relative imports are confirmed", () => {
  const root = temp("confirmed");
  put(root, "README.md", "# Demo\n");
  put(root, "package.json", "{ broken");
  put(root, "src/app.js", "import thing from './missing.js';\n");
  const report = auditProject({ projectPath: root });
  assert.ok(report.findings.some((finding) => finding.code === "malformed-package-json" && finding.confidence === "confirmed"));
  assert.ok(report.findings.some((finding) => finding.code === "broken-relative-import" && finding.confidence === "confirmed"));
});

test("Vite resource queries resolve against the underlying file", () => {
  const root = temp("vite-query");
  put(root, "README.md", "# Vite Demo\n");
  put(root, "package.json", JSON.stringify({ scripts: { test: "node --test" }, devDependencies: { vite: "1.0.0" } }));
  put(root, "package-lock.json", "{}\n");
  put(root, "src/styles.css", "body{}\n");
  put(root, "src/app.ts", "import stylesHref from './styles.css?url';\nexport default stylesHref;\n");
  const report = auditProject({ projectPath: root });
  assert.ok(report.stack.includes("Vite"));
  assert.equal(report.findings.some((finding) => finding.code === "broken-relative-import"), false);
});

test("Electron adapter reports risky webPreferences without running the app", () => {
  const root = temp("electron");
  put(root, "README.md", "# Electron Demo\n");
  put(root, "package.json", JSON.stringify({ main: "main.js", scripts: { test: "node --test" }, devDependencies: { electron: "1.0.0" } }));
  put(root, "package-lock.json", "{}\n");
  put(root, "main.js", "new BrowserWindow({webPreferences:{nodeIntegration:true,contextIsolation:false}});\n");
  const report = auditProject({ projectPath: root });
  assert.ok(report.stack.includes("Electron"));
  assert.ok(report.findings.some((finding) => finding.code === "electron-node-integration" && finding.confidence === "likely"));
  assert.ok(report.findings.some((finding) => finding.code === "electron-context-isolation"));
});

test("generated folders and secret values are not read", () => {
  const root = temp("skips");
  put(root, "README.md", "# Demo\n");
  put(root, ".env", "TOP_SECRET=never-report-this-value\n");
  put(root, "node_modules/pkg/index.js", "eval('never scan dependencies')\n");
  const report = auditProject({ projectPath: root });
  const output = JSON.stringify(report);
  assert.doesNotMatch(output, /never-report-this-value/);
  assert.equal(report.findings.some((finding) => finding.code === "dynamic-code-execution"), false);
  assert.ok(report.findings.some((finding) => finding.code === "secret-files-present"));
});

test("deliberately risky strings inside test fixtures are not production findings", () => {
  const root = temp("test-fixtures");
  put(root, "README.md", "# Demo\n");
  put(root, "tests/risky.test.js", "const sample = `import x from './missing.js'; eval('fixture'); nodeIntegration:true`;\n");
  const report = auditProject({ projectPath: root });
  assert.equal(report.findings.some((finding) => ["broken-relative-import", "dynamic-code-execution", "electron-node-integration"].includes(finding.code)), false);
});

test("intentional Node CLI output is not debug residue", () => {
  const root = temp("cli-output");
  put(root, "README.md", "# CLI\n");
  put(root, "report.js", `#!/usr/bin/env node
const detector = /\\b(?:debugger|console\\.log)\\b/g;
const example = "debugger; console.log";
const examples = ["debugger;", 'debugger;', /debugger;/, /debugger;/];
console.log("one"); console.log("two"); console.log("three"); console.log("four");
console.log("five"); console.log("six"); console.log("seven"); console.log(detector, example, examples);
`);
  const report = auditProject({ projectPath: root });
  assert.equal(report.findings.some((finding) => finding.code === "debug-residue"), false);
});

test("executable debugger statements remain actionable inside Node CLIs", () => {
  const root = temp("cli-debugger");
  put(root, "README.md", "# CLI\n");
  put(root, "report.js", `#!/usr/bin/env node
console.log("intentional output");
debugger;
if (true) { debugger; }
debugger;
debugger;
`);
  const report = auditProject({ projectPath: root });
  const finding = report.findings.find((item) => item.code === "debug-residue");
  assert.ok(finding);
  assert.equal(finding.message, "4 debugger or console.log statements remain in source files.");
  assert.equal(finding.file, "report.js");
  assert.equal(finding.line, 3);
});

test("console.log detection remains active in ordinary application source", () => {
  const root = temp("app-debug-output");
  put(root, "README.md", "# App\n");
  put(root, "src/app.js", `console.log("one");
console.log("two");
console.log("three");
console.log("four");
`);
  const report = auditProject({ projectPath: root });
  const finding = report.findings.find((item) => item.code === "debug-residue");
  assert.ok(finding);
  assert.equal(finding.message, "4 debugger or console.log statements remain in source files.");
  assert.equal(finding.file, "src/app.js");
  assert.equal(finding.line, 1);
});

test("scan bounds and escaping symlinks remain visible", { skip: process.platform === "win32" }, () => {
  const root = temp("bounds"); const outside = temp("outside");
  put(root, "README.md", "# Demo\n"); put(outside, "outside.js", "export default 1\n");
  fs.symlinkSync(path.join(outside, "outside.js"), path.join(root, "escape.js"));
  for (let i = 0; i < 8; i++) put(root, `src/${i}.js`, `export default ${i}\n`);
  const report = auditProject({ projectPath: root, limits: { maxFiles: 3, maxTotalBytes: 1024, maxFileBytes: 1024, maxDurationMs: 1000 } });
  assert.ok(report.findings.some((finding) => finding.code === "scan-limit"));
  assert.ok(report.findings.some((finding) => finding.code === "symlink-escape"));
});

test("bounded scans verify exact relative-import targets outside the collected file set", () => {
  const root = temp("bounded-imports");
  put(root, "README.md", "# Demo\n");
  put(root, "main.js", "require('./taskdelete');\nrequire('./missing');\nrequire('./TaskDelete');\n");
  for (let i = 0; i < 8; i++) put(root, `middle/${i}.js`, `export default ${i}\n`);
  put(root, "taskdelete.js", "module.exports = {};\n");
  const report = auditProject({ projectPath: root, limits: { maxFiles: 3, maxTotalBytes: 4096, maxFileBytes: 1024, maxDurationMs: 1000 } });
  const broken = report.findings.filter((finding) => finding.code === "broken-relative-import");
  assert.ok(report.findings.some((finding) => finding.code === "scan-limit"));
  assert.equal(broken.some((finding) => /\.\/taskdelete$/.test(finding.message)), false);
  assert.ok(broken.some((finding) => /\.\/missing$/.test(finding.message)));
  assert.ok(broken.some((finding) => /\.\/TaskDelete$/.test(finding.message)));
});

test("generated backup installs do not consume the project scan budget", () => {
  const root = temp("backup-install");
  put(root, "README.md", "# Demo\n");
  put(root, "main.js", "require('./taskdelete');\n");
  for (let i = 0; i < 8; i++) put(root, `mcp/.backup-install/node_modules-copy/${i}.js`, `export default ${i}\n`);
  put(root, "taskdelete.js", "module.exports = {};\n");
  const report = auditProject({ projectPath: root, limits: { maxFiles: 3, maxTotalBytes: 4096, maxFileBytes: 1024, maxDurationMs: 1000 } });
  assert.equal(report.fileCount, 3);
  assert.equal(report.findings.some((finding) => finding.code === "scan-limit"), false);
  assert.equal(report.findings.some((finding) => finding.code === "broken-relative-import"), false);
});

test("Workspace artifact folders are disclosed and excluded before every downstream check", () => {
  const root = temp("workspace-artifacts");
  const artifactDirs = [".backup-install", ".backup-pipeline", ".proof", ".proof-pipeline", ".trash"];
  const riskySource = `require('./missing');
// TODO TODO TODO TODO TODO TODO TODO TODO
console.log('one'); console.log('two'); console.log('three'); console.log('four');
try { throw new Error('fixture'); } catch {}
eval('fixture');
`;
  const large = Buffer.alloc(1024 * 1024 + 64, 0xef);
  put(root, "README.md", "# Artifact boundary\n");
  for (const dir of artifactDirs) {
    put(root, `${dir}/risky.js`, riskySource);
    put(root, `${dir}/large.png`, large);
    put(root, `${dir}/.env`, "DO_NOT_READ=fixture-secret\n");
  }

  const report = auditProject({ projectPath: root });
  const notices = report.notices.filter((notice) => notice.code === "workspace-artifact-excluded");
  const blockedCodes = new Set([
    "broken-relative-import", "debug-residue", "dynamic-code-execution", "empty-catch",
    "large-project-files", "secret-files-present", "todo-concentration",
  ]);
  assert.equal(report.fileCount, 1);
  assert.equal(report.findings.some((finding) => blockedCodes.has(finding.code)), false);
  assert.equal(notices.length, artifactDirs.length);
  assert.deepEqual(notices.map((notice) => notice.message.match(/folder ([^;]+)/)[1]).sort(), artifactDirs.sort());
  assert.deepEqual([...new Set(notices.map((notice) => notice.classification))].sort(), [
    "workspace-install-backup", "workspace-recoverable-trash", "workspace-review-proof", "workspace-task-backup",
  ]);
  assert.match(humanReport(report), /Scan boundaries \(5\)/);
  assert.match(humanReport(report), /workspace-review-proof.*\.proof-pipeline/);
});

test("Workspace editor backup files are disclosed and excluded before every downstream check", () => {
  const root = temp("workspace-backup-files");
  const riskySource = `require('./missing');
// TODO TODO TODO TODO TODO TODO TODO TODO
console.log('one'); console.log('two'); console.log('three'); console.log('four');
try { throw new Error('fixture'); } catch {}
eval('fixture');
`;
  // Past the 512 KiB text bound AND past the 1 MiB large-file bound, so an unskipped copy
  // would raise oversized-text and large-project-files exactly like the real leftover did.
  const oversizedRisky = riskySource + "// " + "x".repeat(1024 * 1024) + "\n";
  const readme = "# Editor backup boundary\n";
  const backupNames = ["sample.bak", "sample.bak-20260822"];
  put(root, "README.md", readme);
  for (const name of backupNames) put(root, name, oversizedRisky);

  const report = auditProject({ projectPath: root });
  const notices = report.notices.filter((notice) => notice.code === "workspace-artifact-excluded");
  const blockedCodes = new Set([
    "broken-relative-import", "debug-residue", "dynamic-code-execution", "empty-catch",
    "large-project-files", "oversized-text", "todo-concentration",
  ]);
  assert.equal(notices.length, backupNames.length);
  assert.deepEqual(notices.map((notice) => notice.message.match(/file ([^;]+)/)[1]).sort(), backupNames.slice().sort());
  assert.deepEqual([...new Set(notices.map((notice) => notice.classification))], ["workspace-editor-backup"]);
  assert.equal(notices.every((notice) => notice.actionable === false), true);
  assert.equal(report.notices.some((notice) => notice.code === "oversized-text"), false);
  assert.equal(report.findings.some((finding) => blockedCodes.has(finding.code)), false);
  assert.equal(report.fileCount, 1);
  assert.equal(report.totalBytes, Buffer.byteLength(readme));
  assert.equal(report.status, "Healthy");
  assert.match(humanReport(report), /workspace-editor-backup.*sample\.bak/);
});

test("editor-backup lookalikes stay scanned and ordinary oversized source stays actionable", () => {
  const root = temp("backup-lookalikes");
  const riskySource = `require('./missing');
// TODO TODO TODO TODO TODO TODO TODO TODO
console.log('one'); console.log('two'); console.log('three'); console.log('four');
try { throw new Error('fixture'); } catch {}
eval('fixture');
`;
  put(root, "README.md", "# Lookalike boundary\n");
  put(root, "backup.js", riskySource);
  put(root, "notes.bakup", "notes kept as ordinary text\n");
  put(root, "src/config.json", `{"pad":"${"y".repeat(600 * 1024)}"}`);

  const report = auditProject({ projectPath: root });
  const codes = new Set(report.findings.map((finding) => finding.code));
  assert.equal(report.notices.some((notice) => notice.code === "workspace-artifact-excluded"), false);
  assert.equal(report.fileCount, 4);
  for (const code of [
    "broken-relative-import", "debug-residue", "dynamic-code-execution", "empty-catch",
    "oversized-text", "todo-concentration",
  ]) assert.ok(codes.has(code), `expected lookalike/ordinary finding ${code}`);
  const oversized = report.notices.find((notice) => notice.code === "oversized-text");
  assert.equal(oversized.actionable, true);
  assert.match(oversized.message, /src\/config\.json/);
});

test("skipped editor backups consume no scan budget and never hide ordinary source", () => {
  const root = temp("backup-budget");
  put(root, "README.md", "# Budget boundary\n");
  put(root, "src/app.js", "export const value = 1;\n");
  for (let index = 0; index < 12; index += 1) put(root, `bulk-${index}.js.bak-20260822`, "x".repeat(4096));

  const report = auditProject({ projectPath: root, limits: { maxFiles: 3, maxFileBytes: 1024, maxTotalBytes: 4096, maxDurationMs: 4000 } });
  assert.equal(report.notices.filter((notice) => notice.code === "workspace-artifact-excluded").length, 12);
  assert.equal(report.notices.some((notice) => notice.code === "scan-limit"), false);
  assert.equal(report.findings.some((finding) => finding.code === "scan-limit"), false);
  assert.equal(report.fileCount, 2);
  assert.equal(report.totalBytes, Buffer.byteLength("# Budget boundary\n") + Buffer.byteLength("export const value = 1;\n"));
});

test("a backed-up secret file is still disclosed as secret-like, not silenced as a backup", () => {
  const root = temp("backup-secret-order");
  put(root, "README.md", "# Secret ordering boundary\n");
  put(root, ".env.bak", "DO_NOT_READ=fixture-secret\n");

  const report = auditProject({ projectPath: root });
  assert.ok(report.findings.some((finding) => finding.code === "secret-files-present"));
  assert.equal(report.notices.some((notice) => notice.classification === "workspace-editor-backup"), false);
  assert.doesNotMatch(JSON.stringify(report), /fixture-secret/);
});

test("scratch demo trees raise no runtime-source or large-file findings", () => {
  const root = temp("demos-tree");
  put(root, "README.md", "# Demos boundary\n");
  put(root, "package.json", JSON.stringify({ name: "demo-host", main: "main.js", devDependencies: { electron: "30.0.0" } }));
  put(root, "package-lock.json", "{}\n");
  put(root, "main.js", "const { BrowserWindow } = require('electron');\nmodule.exports = BrowserWindow;\n");
  // Every runtime heuristic's trigger at once, inside the scratch driver tree.
  put(root, "demos/redesign-shell/_tools/colvar.js", `require('./missing-target');
// TODO FIXME TODO FIXME TODO FIXME TODO FIXME
console.log('one'); console.log('two'); console.log('three'); console.log('four');
try { throw new Error('fixture'); } catch {}
eval('fixture');
new BrowserWindow({ webPreferences: { webSecurity: false, nodeIntegration: true, contextIsolation: false, sandbox: false } });
`);
  put(root, "demos/redesign-shell/delivery-after.png", "x".repeat(1024 * 1024 + 16));

  const report = auditProject({ projectPath: root });
  assert.ok(report.stack.includes("Electron"));
  for (const code of [
    "broken-relative-import", "debug-residue", "dynamic-code-execution", "empty-catch",
    "electron-web-security", "electron-node-integration", "electron-context-isolation",
    "electron-sandbox-disabled", "large-project-files", "todo-concentration",
  ]) assert.equal(report.findings.some((finding) => finding.code === code), false, `demos tree raised ${code}`);
  assert.equal(report.findings.some((finding) => finding.file.startsWith("demos/")), false);
  const notice = report.notices.find((item) => item.code === "non-production-large-asset");
  assert.ok(notice);
  assert.equal(notice.actionable, false);
  assert.match(notice.message, /demos\/redesign-shell\/delivery-after\.png/);
});

test("session tmp trees consume no scan budget and never hide ordinary source", () => {
  const root = temp("tmp-budget");
  const readme = "# Tmp boundary\n";
  const app = `console.log("one");
console.log("two");
console.log("three");
console.log("four");
`;
  put(root, "README.md", readme);
  put(root, "src/app.js", app);
  for (let index = 0; index < 12; index += 1) {
    put(root, `tmp/pdfs/workspace-guides/bulk-${index}.mjs`, "console.log('leftover');\n".repeat(8));
  }

  const report = auditProject({ projectPath: root, limits: { maxFiles: 3, maxFileBytes: 1024, maxTotalBytes: 4096, maxDurationMs: 4000 } });
  assert.equal(report.fileCount, 2);
  assert.equal(report.totalBytes, Buffer.byteLength(readme) + Buffer.byteLength(app));
  assert.equal(report.notices.some((notice) => notice.code === "scan-limit"), false);
  assert.equal(report.findings.some((finding) => finding.code === "scan-limit"), false);
  // The ordinary source file beside tmp is still collected and still actionable.
  const residue = report.findings.find((finding) => finding.code === "debug-residue");
  assert.ok(residue);
  assert.equal(residue.file, "src/app.js");
  assert.equal(residue.message, "4 debugger or console.log statements remain in source files.");
});

test("skill starter templates raise no runtime-source or large-file findings", () => {
  const root = temp("skill-templates");
  put(root, "README.md", "# Templates boundary\n");
  put(root, "skills-library/example/templates/component-library.tsx", `console.log("Clicked!");
console.log("two"); console.log("three"); console.log("four");
try { throw new Error('fixture'); } catch {}
`);
  put(root, "skills-library/example/templates/arbitrary-name.png", "x".repeat(1024 * 1024 + 16));

  const report = auditProject({ projectPath: root });
  for (const code of ["debug-residue", "empty-catch", "large-project-files"]) {
    assert.equal(report.findings.some((finding) => finding.code === code), false, `template tree raised ${code}`);
  }
  const notice = report.notices.find((item) => item.code === "non-production-large-asset");
  assert.ok(notice);
  assert.equal(notice.actionable, false);
  assert.match(notice.message, /skills-library\/example\/templates\/arbitrary-name\.png/);
});

// The three exclusions do NOT share one boundary, and the shipped documents now say so:
// the two sample trees are dropped from the runtime RULES but still collected, so they stay
// in the digest; tmp/ is dropped at TRAVERSAL, so it is outside the digest entirely.
test("A `tmp/` directory is dropped before file collection, so changing a file there leaves both the file count and digest unchanged", () => {
  const root = temp("digest-boundary");
  put(root, "README.md", "# Digest boundary\n");
  put(root, "package.json", JSON.stringify({ name: "digest-host", version: "1.0.0" }));
  put(root, "src/app.js", "module.exports = 1;\n");
  const baseline = auditProject({ projectPath: root });

  // tmp/ never reaches collection, so its file moves neither the digest nor the file count.
  put(root, "tmp/nested/ignored.js", "console.log('leftover');\n");
  const afterTmp = auditProject({ projectPath: root });
  assert.equal(afterTmp.digest, baseline.digest, "a tmp/ file must not move the project digest");
  assert.equal(afterTmp.fileCount, baseline.fileCount);

  // Both sample trees are still collected, so a change inside either one still moves the
  // digest the human compares two scans by.
  put(root, "demos/sample.js", "console.log('demo');\n");
  const afterDemos = auditProject({ projectPath: root });
  assert.notEqual(afterDemos.digest, afterTmp.digest, "a demos/ file must move the project digest");
  assert.equal(afterDemos.fileCount, baseline.fileCount + 1);

  put(root, "skills-library/example/templates/starter.tsx", "console.log('starter');\n");
  const afterTemplates = auditProject({ projectPath: root });
  assert.notEqual(afterTemplates.digest, afterDemos.digest, "a skill templates/ file must move the project digest");
  assert.equal(afterTemplates.fileCount, baseline.fileCount + 2);

  // Staying in the digest never made either sample tree production evidence.
  assert.equal(afterTemplates.findings.some((finding) => finding.code === "debug-residue"), false);
});


test("close lookalikes outside the exclusions stay fully actionable", () => {
  const root = temp("nonproduction-lookalikes");
  const four = `console.log("one");
console.log("two");
console.log("three");
console.log("four");
`;
  put(root, "README.md", "# Lookalike boundary\n");
  put(root, "package.json", JSON.stringify({ name: "look", main: "main.js", devDependencies: { electron: "30.0.0" } }));
  put(root, "package-lock.json", "{}\n");
  put(root, "demo-debug.js", four);        // a name that merely starts like "demos", not the segment
  put(root, "src/templates/app.js", four); // a templates folder that is not a skill package's
  put(root, "src/app.js", four);
  put(root, "main.js", "const { BrowserWindow } = require('electron');\nnew BrowserWindow({ webPreferences: { webSecurity: false } });\n");
  put(root, "hero.png", "x".repeat(1024 * 1024 + 16));

  const report = auditProject({ projectPath: root });
  const residue = report.findings.find((finding) => finding.code === "debug-residue");
  assert.ok(residue);
  assert.equal(residue.message, "12 debugger or console.log statements remain in source files.");
  const electron = report.findings.find((finding) => finding.code === "electron-web-security");
  assert.ok(electron);
  assert.equal(electron.file, "main.js");
  const large = report.findings.find((finding) => finding.code === "large-project-files");
  assert.ok(large);
  assert.equal(large.file, "hero.png");
  assert.equal(report.notices.some((item) => item.code === "non-production-large-asset"), false);
});

test("the same large and risky evidence remains actionable in ordinary project source", () => {
  const root = temp("ordinary-risky-source");
  const riskySource = `require('./missing');
// TODO TODO TODO TODO TODO TODO TODO TODO
console.log('one'); console.log('two'); console.log('three'); console.log('four');
try { throw new Error('fixture'); } catch {}
eval('fixture');
`;
  put(root, "README.md", "# Ordinary source boundary\n");
  put(root, "src/risky.js", riskySource);
  put(root, "src/large.png", Buffer.alloc(1024 * 1024 + 64, 0xef));
  put(root, ".env", "DO_NOT_READ=fixture-secret\n");

  const report = auditProject({ projectPath: root });
  const codes = new Set(report.findings.map((finding) => finding.code));
  for (const code of [
    "broken-relative-import", "debug-residue", "dynamic-code-execution", "empty-catch",
    "large-project-files", "secret-files-present", "todo-concentration",
  ]) assert.ok(codes.has(code), `expected ordinary source finding ${code}`);
  assert.doesNotMatch(JSON.stringify(report), /fixture-secret/);
});

test("broken project symlinks are disclosed with a safe resolution code", { skip: process.platform === "win32" }, () => {
  const root = temp("broken-symlink");
  put(root, "README.md", "# Demo\n");
  fs.symlinkSync(path.join(root, "missing-target.js"), path.join(root, "broken.js"));
  const report = auditProject({ projectPath: root });
  const notice = report.notices.find((item) => item.code === "symlink-unresolved");
  assert.ok(notice);
  assert.match(notice.message, /\(ENOENT\).*broken\.js/);
  assert.ok(report.findings.some((finding) => finding.code === "symlink-unresolved"));
});

test("oversized reference data is notice-only while oversized source stays actionable", () => {
  const root = temp("oversized-classification");
  put(root, "README.md", "# Demo\n");
  put(root, "reference/catalog.csv", `name,value\n${"alpha,beta\n".repeat(24)}`);
  put(root, "src/config.json", `{"payload":"${"x".repeat(256)}"}\n`);
  const report = auditProject({ projectPath: root, limits: { maxFiles: 20, maxTotalBytes: 4096, maxFileBytes: 64, maxDurationMs: 1000 } });
  const dataNotice = report.notices.find((notice) => /reference\/catalog\.csv/.test(notice.message));
  const sourceNotice = report.notices.find((notice) => /src\/config\.json/.test(notice.message));
  assert.equal(dataNotice.actionable, false);
  assert.equal(dataNotice.classification, "reference-data");
  assert.equal(report.findings.some((finding) => /reference\/catalog\.csv/.test(finding.message)), false);
  assert.equal(sourceNotice.actionable, true);
  assert.ok(report.findings.some((finding) => finding.code === "oversized-text" && /src\/config\.json/.test(finding.message)));
});

test("declared build and distribution assets stay visible without inflating large-file findings", () => {
  const root = temp("intentional-large-assets");
  const large = Buffer.alloc(1024 * 1024 + 64, 0xab);
  put(root, "README.md", "# Electron assets\n");
  put(root, "package.json", JSON.stringify({
    main: "main.js",
    scripts: { test: "node --test" },
    devDependencies: { electron: "1.0.0" },
    build: { files: ["main.js", "logo.png"], mac: { icon: "App.icns" } },
  }));
  put(root, "package-lock.json", "{}\n");
  put(root, "main.js", "module.exports = {};\n");
  put(root, "App.icns", large);
  put(root, "App.iconset/icon_512x512@2x.png", large);
  put(root, "logo-src.png", large);
  put(root, "logo.png", "optimized");
  put(root, "skills-library-zips/demo-skill.zip", large);
  put(root, "skills-library/demo-skill/SKILL.md", "# Demo\n");
  put(root, "hero.png", large);
  const report = auditProject({ projectPath: root });
  const notices = report.notices.filter((notice) => notice.code === "intentional-large-asset");
  assert.deepEqual(notices.map((notice) => notice.classification).sort(), [
    "declared-build-icon", "distribution-archive", "icon-generation-source", "packaged-source-master",
  ]);
  const finding = report.findings.find((item) => item.code === "large-project-files");
  assert.ok(finding);
  assert.equal(finding.message, "1 project file exceeds 1 MiB; largest is hero.png.");
});

test("declared packaging-excluded human deliverables stay visible without hiding ordinary large files", () => {
  const root = temp("declared-human-deliverables");
  const large = Buffer.alloc(1024 * 1024 + 64, 0xda);
  put(root, "README.md", "# Human deliverables\n");
  put(root, "package.json", JSON.stringify({
    main: "main.js",
    scripts: { test: "node --test" },
    devDependencies: { electron: "1.0.0" },
    build: { files: ["main.js", "assets/**/*"] },
    projectDoctor: { intentionalLargeAssets: [
      { path: "output/pdf/guide-one.pdf", kind: "human-deliverable" },
      { path: "output/pdf/guide-two.pdf", kind: "human-deliverable" },
    ] },
  }));
  put(root, "package-lock.json", "{}\n");
  put(root, "main.js", "module.exports = {};\n");
  put(root, "output/pdf/guide-one.pdf", large);
  put(root, "output/pdf/guide-two.pdf", large);
  put(root, "hero.png", large);

  const report = auditProject({ projectPath: root });
  const notices = report.notices.filter((notice) => notice.classification === "declared-human-deliverable");
  assert.equal(notices.length, 2);
  assert.ok(notices.every((notice) => notice.actionable === false));
  assert.ok(notices.some((notice) => /output\/pdf\/guide-one\.pdf/.test(notice.message)));
  assert.ok(notices.some((notice) => /output\/pdf\/guide-two\.pdf/.test(notice.message)));
  const finding = report.findings.find((item) => item.code === "large-project-files");
  assert.ok(finding);
  assert.equal(finding.message, "1 project file exceeds 1 MiB; largest is hero.png.");
});

test("the same large PDF without an exact declaration remains actionable", () => {
  const root = temp("undeclared-human-deliverable");
  put(root, "README.md", "# Undeclared deliverable\n");
  put(root, "package.json", JSON.stringify({
    main: "main.js",
    scripts: { test: "node --test" },
    devDependencies: { electron: "1.0.0" },
    build: { files: ["main.js"] },
  }));
  put(root, "package-lock.json", "{}\n");
  put(root, "main.js", "module.exports = {};\n");
  put(root, "output/pdf/guide.pdf", Buffer.alloc(1024 * 1024 + 64, 0xdb));

  const report = auditProject({ projectPath: root });
  assert.equal(report.notices.some((notice) => notice.classification === "declared-human-deliverable"), false);
  const finding = report.findings.find((item) => item.code === "large-project-files");
  assert.ok(finding);
  assert.match(finding.message, /output\/pdf\/guide\.pdf/);
});

test("packaged, traversing, globbed, stale, and unknown deliverable declarations fail closed", () => {
  const root = temp("unsafe-human-deliverables");
  const large = Buffer.alloc(1024 * 1024 + 64, 0xdc);
  put(root, "README.md", "# Unsafe declarations\n");
  put(root, "package.json", JSON.stringify({
    main: "main.js",
    scripts: { test: "node --test" },
    devDependencies: { electron: "1.0.0" },
    build: { files: ["main.js", "output/pdf/packaged.pdf"] },
    projectDoctor: { intentionalLargeAssets: [
      { path: "output/pdf/packaged.pdf", kind: "human-deliverable" },
      { path: "../output/pdf/traversing.pdf", kind: "human-deliverable" },
      { path: "output/pdf/*.pdf", kind: "human-deliverable" },
      { path: "output/pdf/stale.pdf", kind: "human-deliverable" },
      { path: "output/pdf/unknown.pdf", kind: "other" },
    ] },
  }));
  put(root, "package-lock.json", "{}\n");
  put(root, "main.js", "module.exports = {};\n");
  put(root, "output/pdf/packaged.pdf", large);
  put(root, "output/pdf/traversing.pdf", large);
  put(root, "output/pdf/globbed.pdf", large);
  put(root, "output/pdf/unknown.pdf", large);

  const report = auditProject({ projectPath: root });
  assert.equal(report.notices.some((notice) => notice.classification === "declared-human-deliverable"), false);
  const finding = report.findings.find((item) => item.code === "large-project-files");
  assert.ok(finding);
  assert.match(finding.message, /^4 project files exceed 1 MiB;/);
});

test("large asset names without their required evidence remain actionable", () => {
  const root = temp("unproven-large-assets");
  const large = Buffer.alloc(1024 * 1024 + 64, 0xcd);
  put(root, "README.md", "# Unproven assets\n");
  put(root, "package.json", JSON.stringify({ scripts: { test: "node --test" }, build: { files: ["app.js"] } }));
  put(root, "package-lock.json", "{}\n");
  put(root, "app.js", "module.exports = {};\n");
  put(root, "Unused.icns", large);
  put(root, "Unused.iconset/icon_512x512@2x.png", large);
  put(root, "cover-src.png", large);
  put(root, "cover.png", "optimized but not packaged");
  put(root, "skills-library-zips/missing-skill.zip", large);
  const report = auditProject({ projectPath: root });
  assert.equal(report.notices.some((notice) => notice.code === "intentional-large-asset"), false);
  const finding = report.findings.find((item) => item.code === "large-project-files");
  assert.ok(finding);
  assert.match(finding.message, /^4 project files exceed 1 MiB;/);
});

test("unavailable projects fail honestly and exact findings resolve by digest", () => {
  const missing = path.join(temp("missing"), "nope");
  const unavailable = auditProject({ projectPath: missing, projectId: "gone" });
  assert.equal(unavailable.status, "Unavailable");
  assert.equal(unavailable.findings[0].confidence, "confirmed");
  assert.ok(resolveFinding(unavailable, { digest: unavailable.digest, findingId: unavailable.findings[0].id }));
  assert.equal(resolveFinding(unavailable, { digest: "0".repeat(64), findingId: unavailable.findings[0].id }), null);
});
