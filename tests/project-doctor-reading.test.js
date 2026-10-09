"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// Allows the same public-API regressions to prove RED against the session backup.
const { auditProject } = require(process.env.PROJECT_DOCTOR_READING_MODULE ||
  "../skills/audit-project-health/scripts/audit-project");

function temp(t, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `project-doctor-reading-${label}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function put(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

function brokenImports(report) {
  return report.findings.filter((finding) => finding.code === "broken-relative-import");
}

const typeScriptTargets = [
  [".ts", ".js", ".ts"],
  [".tsx", ".js", ".tsx"],
  [".tsx", ".jsx", ".tsx"],
  [".ts", ".mjs", ".mts"],
  [".ts", ".cjs", ".cts"],
  [".mts", ".mjs", ".mts"],
  [".cts", ".cjs", ".cts"],
  [".ts", ".js", ".d.ts"],
  [".ts", ".mjs", ".d.mts"],
  [".ts", ".cjs", ".d.cts"],
];

for (const [sourceExt, importExt, targetExt] of typeScriptTargets) {
  test(`TypeScript ${sourceExt} source resolves ${importExt} imports to ${targetExt} files`, (t) => {
    const root = temp(t, "typescript-substitution");
    put(root, "README.md", "# TypeScript resolution\n");
    put(root, `src/main${sourceExt}`, `import type { Value } from './value${importExt}';\n`);
    put(root, `src/value${targetExt}`, "export interface Value { count: number }\n");

    const report = auditProject({ projectPath: root });
    assert.deepEqual(brokenImports(report), []);
  });
}

test("TypeScript emitted extensions resolve outside the bounded file index", (t) => {
  const root = temp(t, "bounded-typescript");
  put(root, "README.md", "# Bounded TypeScript\n");
  put(root, "a-main.ts", [
    "import { value } from './z-value.js';",
    "import type { View } from './z-view.js';",
    "import { moduleValue } from './z-module.mjs';",
    "import { commonValue } from './z-common.cjs';",
    "import type { Declared } from './z-declared.js';",
    "import type { Missing } from './z-missing.js';",
    "import type { WrongCase } from './z-Value.js';",
  ].join("\n"));
  for (let i = 0; i < 8; i += 1) put(root, `middle/${i}.txt`, "bounded padding\n");
  put(root, "z-value.ts", "export const value = 1;\n");
  put(root, "z-view.tsx", "export interface View {}\n");
  put(root, "z-module.mts", "export const moduleValue = 1;\n");
  put(root, "z-common.cts", "export const commonValue = 1;\n");
  put(root, "z-declared.d.ts", "export interface Declared {}\n");

  const report = auditProject({ projectPath: root, limits: {
    maxFiles: 3, maxFileBytes: 1024, maxTotalBytes: 4096, maxDurationMs: 4000,
  } });
  assert.ok(report.findings.some((finding) => finding.code === "scan-limit"));
  assert.equal(report.fileCount, 3);
  assert.deepEqual(brokenImports(report).map((finding) => finding.message).sort(), [
    "Relative import does not resolve: ./z-missing.js",
    "Relative import does not resolve: ./z-Value.js",
  ].sort());
});

for (const sourceExt of [".ts", ".tsx", ".mts", ".cts"]) {
  test(`TypeScript ${sourceExt} source still reports missing imports and wrong filename case`, (t) => {
    const root = temp(t, "typescript-missing");
    put(root, "README.md", "# Missing TypeScript imports\n");
    put(root, `src/main${sourceExt}`, [
      "import { missing } from './missing.js';",
      "import { value } from './Value.js';",
    ].join("\n"));
    put(root, "src/value.ts", "export const value = 1;\n");

    const report = auditProject({ projectPath: root });
    assert.deepEqual(brokenImports(report).map((finding) => finding.message).sort(), [
      "Relative import does not resolve: ./missing.js",
      "Relative import does not resolve: ./Value.js",
    ].sort());
    assert.ok(brokenImports(report).every((finding) => finding.confidence === "confirmed"));
  });
}

test("TypeScript substitution refuses a matching source symlink escaping the project", { skip: process.platform === "win32" }, (t) => {
  const root = temp(t, "typescript-symlink");
  const outside = temp(t, "outside");
  put(root, "README.md", "# TypeScript link boundary\n");
  put(root, "src/main.ts", "import { value } from './escape.js';\n");
  const externalFile = put(outside, "escape.ts", "export const value = 'outside-do-not-read';\n");
  fs.symlinkSync(externalFile, path.join(root, "src/escape.ts"));

  const report = auditProject({ projectPath: root });
  assert.equal(brokenImports(report).length, 1);
  assert.match(brokenImports(report)[0].message, /\.\/escape\.js$/);
  assert.ok(report.findings.some((finding) => finding.code === "symlink-escape"));
  assert.doesNotMatch(JSON.stringify(report), /outside-do-not-read/);
});

for (const spec of ["./value.js", "./value"]) {
  test(`plain JavaScript import ${spec} cannot be satisfied by a lone TypeScript source`, (t) => {
    const root = temp(t, "javascript-boundary");
    put(root, "README.md", "# JavaScript runtime\n");
    put(root, "src/main.js", `const value = require('${spec}');\n`);
    put(root, "src/value.ts", "export const value = 1;\n");

    const report = auditProject({ projectPath: root });
    assert.equal(brokenImports(report).length, 1);
    assert.equal(brokenImports(report)[0].message, `Relative import does not resolve: ${spec}`);
  });
}

test("unrelated TypeScript tooling does not excuse a broken JavaScript runtime import", (t) => {
  const root = temp(t, "javascript-with-typescript");
  put(root, "README.md", "# JavaScript entry with TypeScript tooling\n");
  put(root, "package.json", JSON.stringify({ devDependencies: { typescript: "5.0.0" } }));
  put(root, "tsconfig.json", JSON.stringify({ include: ["src/**/*.ts"] }));
  put(root, "main.js", "const value = require('./src/value.js');\n");
  put(root, "src/value.ts", "export const value = 1;\n");

  const report = auditProject({ projectPath: root });
  assert.equal(brokenImports(report).length, 1);
  assert.equal(brokenImports(report)[0].file, "main.js");
});

function electronProject(root, output) {
  const pkg = {
    main: "main.js", scripts: { test: "node --test" },
    devDependencies: { electron: "30.0.0" },
  };
  if (output !== undefined) pkg.build = { directories: { output } };
  put(root, "README.md", "# Electron output boundary\n");
  put(root, "package.json", JSON.stringify(pkg));
  put(root, "package-lock.json", "{}\n");
  put(root, "main.js", "module.exports = {};\n");
}

function nonactionableNotice(report, rel) {
  return report.notices.some((notice) => notice.actionable === false && notice.message.includes(rel));
}

test("declared Electron output is disclosed and excluded before collection and scan budgets", (t) => {
  const root = temp(t, "electron-output");
  electronProject(root, "release");
  const baseline = auditProject({ projectPath: root });
  for (let i = 0; i < 12; i += 1) {
    put(root, `release/packaged/app-${i}.js`, "require('./missing-bundled-file');\n".repeat(50));
  }
  const report = auditProject({ projectPath: root, limits: {
    maxFiles: 5, maxFileBytes: 1024, maxTotalBytes: 4096, maxDurationMs: 4000,
  } });

  assert.equal(report.fileCount, baseline.fileCount);
  assert.equal(report.totalBytes, baseline.totalBytes);
  assert.equal(report.digest, baseline.digest);
  assert.ok(nonactionableNotice(report, "release"));
  assert.equal(report.findings.some((finding) => finding.code === "scan-limit"), false);
  assert.equal(report.findings.some((finding) => finding.file.startsWith("release/")), false);
  assert.equal(report.notices.some((notice) => notice.code === "oversized-text"), false);
});

test("a folder merely named release stays inspected without the build output declaration", (t) => {
  const root = temp(t, "undeclared-release");
  electronProject(root);
  put(root, "release/handwritten.js", "require('./missing-handwritten-file');\n");

  const report = auditProject({ projectPath: root });
  assert.ok(brokenImports(report).some((finding) => finding.file === "release/handwritten.js"));
  assert.equal(nonactionableNotice(report, "release"), false);
});

test("an output declaration without Electron provenance does not hide source", (t) => {
  const root = temp(t, "non-electron-output");
  put(root, "README.md", "# Unproven build output\n");
  put(root, "package.json", JSON.stringify({ build: { directories: { output: "release" } } }));
  put(root, "release/handwritten.js", "require('./missing-handwritten-file');\n");

  const report = auditProject({ projectPath: root });
  assert.ok(brokenImports(report).some((finding) => finding.file === "release/handwritten.js"));
});

for (const output of [".", "../release", "src", "release/*"]) {
  test(`unsafe Electron output declaration ${output} cannot suppress ordinary source`, (t) => {
    const root = temp(t, "unsafe-electron-output");
    electronProject(root, output);
    put(root, "src/handwritten.js", "require('./missing-source');\n");

    const report = auditProject({ projectPath: root });
    assert.ok(brokenImports(report).some((finding) => finding.file === "src/handwritten.js"));
  });
}

test("Electron output containing the declared package entry remains inspected", (t) => {
  const root = temp(t, "electron-entry-in-output");
  put(root, "README.md", "# Entry boundary\n");
  put(root, "package.json", JSON.stringify({
    main: "release/main.js", devDependencies: { electron: "30.0.0" },
    build: { directories: { output: "release" } },
  }));
  put(root, "release/main.js", "require('./missing-entry-helper');\n");

  const report = auditProject({ projectPath: root });
  assert.ok(brokenImports(report).some((finding) => finding.file === "release/main.js"));
  assert.equal(nonactionableNotice(report, "release"), false);
});

const appId = "com.example.doctorfixture";
function capacitorProject(root, { dependencies = true, rootConfig = true, nativeId = appId } = {}) {
  put(root, "README.md", "# Capacitor artifact boundary\n");
  put(root, "package.json", JSON.stringify({
    scripts: { test: "node --test" },
    dependencies: dependencies ? { "@capacitor/core": "8.0.0", "@capacitor/android": "8.0.0" } : {},
  }));
  put(root, "package-lock.json", "{}\n");
  if (rootConfig) put(root, "capacitor.config.json", JSON.stringify({ appId, webDir: "dist" }));
  if (nativeId) put(root, "android/app/src/main/assets/capacitor.config.json", JSON.stringify({ appId: nativeId }));
}

test("proven Capacitor generated assets and cache consume no budget while native source stays inspected", (t) => {
  const root = temp(t, "capacitor-generated");
  capacitorProject(root);
  const nativePath = "android/app/src/main/java/com/example/MainActivity.java";
  put(root, nativePath, "// hand-written native source\n".repeat(80));
  const limits = { maxFiles: 8, maxFileBytes: 1024, maxTotalBytes: 4096, maxDurationMs: 4000 };
  const baseline = auditProject({ projectPath: root, limits });
  for (const dir of ["android/.gradle", "android/app/src/main/assets/public"]) {
    for (let i = 0; i < 8; i += 1) put(root, `${dir}/generated-${i}.js`, "require('./missing-generated-file');\n".repeat(50));
  }

  const report = auditProject({ projectPath: root, limits });
  assert.equal(report.fileCount, baseline.fileCount);
  assert.equal(report.totalBytes, baseline.totalBytes);
  assert.equal(report.digest, baseline.digest);
  assert.ok(nonactionableNotice(report, "android/.gradle"));
  assert.ok(nonactionableNotice(report, "android/app/src/main/assets/public"));
  assert.equal(report.findings.some((finding) => finding.code === "scan-limit"), false);
  assert.ok(report.findings.some((finding) => finding.code === "oversized-text" && finding.message.includes(nativePath)));
});

for (const [label, provenance] of [
  ["dependencies absent", { dependencies: false }],
  ["root config absent", { rootConfig: false }],
  ["native config absent", { nativeId: null }],
  ["app identifiers mismatch", { nativeId: "com.example.otherapp" }],
]) {
  test(`Capacitor lookalike folders remain inspected when ${label}`, (t) => {
    const root = temp(t, "unproven-capacitor");
    capacitorProject(root, provenance);
    const paths = ["android/.gradle/handwritten.js", "android/app/src/main/assets/public/handwritten.js"];
    for (const rel of paths) put(root, rel, "require('./missing-handwritten-file');\n");

    const report = auditProject({ projectPath: root });
    assert.deepEqual(brokenImports(report).map((finding) => finding.file).sort(), paths.sort());
  });
}

function tabletSnapshot(root, rel, changes = {}) {
  put(root, `${rel}/summary.json`, JSON.stringify({
    takenAt: "2026-09-15T20:10:00.000Z", package: { id: appId }, copy: {}, ...changes,
  }));
  put(root, `${rel}/extracted/assets/app.js`, "require('./missing-backup-file');\n".repeat(40));
}

test("proven tablet snapshots are disclosed and excluded without hiding loose backup-folder source", (t) => {
  const root = temp(t, "tablet-backups");
  capacitorProject(root);
  put(root, ".tablet-backup/source.js", "require('./missing-loose-source');\n");
  const limits = { maxFiles: 8, maxFileBytes: 1024, maxTotalBytes: 4096, maxDurationMs: 4000 };
  const baseline = auditProject({ projectPath: root, limits });
  tabletSnapshot(root, ".tablet-backup/snapshot-one");
  tabletSnapshot(root, ".tablet-backup/snapshot-two");

  const report = auditProject({ projectPath: root, limits });
  assert.equal(report.fileCount, baseline.fileCount);
  assert.equal(report.digest, baseline.digest);
  assert.ok(nonactionableNotice(report, ".tablet-backup/snapshot-one"));
  assert.ok(nonactionableNotice(report, ".tablet-backup/snapshot-two"));
  assert.deepEqual(brokenImports(report).map((finding) => finding.file), [".tablet-backup/source.js"]);
  assert.equal(report.findings.some((finding) => finding.code === "scan-limit"), false);
});

for (const [label, changes] of [
  ["missing timestamp", { takenAt: null }],
  ["invalid timestamp", { takenAt: "recently" }],
  ["wrong app", { package: { id: "com.example.otherapp" } }],
  ["missing copy metadata", { copy: null }],
]) {
  test(`tablet snapshot with ${label} remains inspected`, (t) => {
    const root = temp(t, "unproven-tablet-backup");
    capacitorProject(root);
    tabletSnapshot(root, ".tablet-backup/unproven", changes);

    const report = auditProject({ projectPath: root });
    assert.ok(brokenImports(report).some((finding) => finding.file === ".tablet-backup/unproven/extracted/assets/app.js"));
    assert.equal(nonactionableNotice(report, ".tablet-backup/unproven"), false);
  });
}

test("tablet metadata without a real apk or extracted directory does not hide source", (t) => {
  const root = temp(t, "tablet-missing-directory");
  capacitorProject(root);
  put(root, ".tablet-backup/unproven/summary.json", JSON.stringify({
    takenAt: "2026-09-15T20:10:00.000Z", package: { id: appId }, copy: {},
  }));
  put(root, ".tablet-backup/unproven/source.js", "require('./missing-loose-source');\n");

  const report = auditProject({ projectPath: root });
  assert.ok(brokenImports(report).some((finding) => finding.file === ".tablet-backup/unproven/source.js"));
});

for (const mode of ["oversized", "symlinked"]) {
  test(`tablet ${mode} metadata cannot exclude the snapshot`, { skip: mode === "symlinked" && process.platform === "win32" }, (t) => {
    const root = temp(t, `tablet-${mode}-metadata`);
    capacitorProject(root);
    const metadata = JSON.stringify({
      takenAt: "2026-09-15T20:10:00.000Z", package: { id: appId }, copy: {},
      padding: mode === "oversized" ? "x".repeat(1024 * 1024) : "",
    });
    put(root, ".tablet-backup/unproven/extracted/app.js", "require('./missing-backup-file');\n");
    if (mode === "symlinked") {
      const outside = temp(t, "external-metadata");
      const externalFile = put(outside, "summary.json", metadata);
      fs.symlinkSync(externalFile, path.join(root, ".tablet-backup/unproven/summary.json"));
    } else put(root, ".tablet-backup/unproven/summary.json", metadata);

    const report = auditProject({ projectPath: root });
    assert.ok(brokenImports(report).some((finding) => finding.file === ".tablet-backup/unproven/extracted/app.js"));
    assert.equal(nonactionableNotice(report, ".tablet-backup/unproven"), false);
  });
}
