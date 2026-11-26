"use strict";

const { watchFileReads } = require("./support/project-reads");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const script = require.resolve("../skills/audit-project-health/scripts/audit-project.js");
const { auditProject } = require(script);

function project(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-messages-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

function messages(root, limits) {
  return Object.fromEntries(auditProject({ projectPath: root, limits }).findings.map(f => [f.code, f.message]));
}

test("project findings keep the exact package, import, Electron, PWA and source messages", t => {
  const root = project(t, {
    "package.json": JSON.stringify({ main: "missing.js", dependencies: { electron: "1", "next-pwa": "1" } }),
    "app.js": [
      "require('./absent');",
      "new BrowserWindow({ webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false, sandbox: false } });",
      "// TODO FIXME TODO FIXME TODO FIXME TODO FIXME",
      "debugger; debugger; debugger; debugger;",
    ].join("\n"),
  });
  assert.deepEqual(messages(root), {
    "missing-readme": "No root README.md was found.",
    "missing-package-entry": "package.json declares a missing main entry: missing.js",
    "missing-test-script": "The package has no usable test script.",
    "missing-lockfile": "Dependencies are declared but no recognized lockfile was found.",
    "broken-relative-import": "Relative import does not resolve: ./absent",
    "electron-node-integration": "nodeIntegration is enabled in an Electron renderer.",
    "electron-context-isolation": "Electron context isolation is disabled.",
    "electron-web-security": "Electron web security is disabled.",
    "electron-sandbox-disabled": "The Electron renderer sandbox is explicitly disabled.",
    "pwa-missing-manifest": "PWA tooling is present but no web app manifest was found.",
    "pwa-missing-worker": "PWA tooling is present but no source service worker was found.",
    "todo-concentration": "8 TODO/FIXME markers remain in source files.",
    "debug-residue": "4 debugger or console.log statements remain in source files.",
  });
});

test("project findings keep the exact singular and plural messages", t => {
  const large = Buffer.alloc(1024 * 1024 + 1);
  const source = "try { work(); } catch {}\neval(value);\n";
  const root = project(t, { "README.md": "", ".env": "", "a.png": large, "one.js": source });
  assert.deepEqual(messages(root), {
    "secret-files-present": "1 secret-like file is present in the project tree; contents were not read.",
    "large-project-files": "1 project file exceeds 1 MiB; largest is a.png.",
    "empty-catch": "1 empty catch block suppresses errors without evidence.",
    "dynamic-code-execution": "1 dynamic code execution primitive was found.",
  });
  fs.writeFileSync(path.join(root, ".env.local"), "");
  fs.writeFileSync(path.join(root, "b.png"), large);
  fs.writeFileSync(path.join(root, "two.js"), source);
  assert.deepEqual(messages(root), {
    "secret-files-present": "2 secret-like files are present in the project tree; contents were not read.",
    "large-project-files": "2 project files exceed 1 MiB; largest is a.png.",
    "empty-catch": "2 empty catch blocks suppress errors without evidence.",
    "dynamic-code-execution": "2 dynamic code execution primitives were found.",
  });
});

test("project errors keep their wording around the runtime's diagnostic", t => {
  const badJson = "{";
  const root = project(t, { "README.md": "", "package.json": badJson });
  // JSON.parse supplies different diagnostics across supported Node releases.
  assert.throws(() => JSON.parse(badJson), error => {
    assert.deepEqual(messages(root), { "malformed-package-json": "package.json is not valid JSON: " + error.message });
    return true;
  });
  assert.deepEqual(messages(path.join(root, "README.md")), {
    "project-unavailable": "Project root is unavailable: Target is not a directory",
  });
});

test("file count, text size and metadata limits keep their exact finding messages", t => {
  const root = project(t, { "a.txt": "abcd", "b.txt": "abcd", "README.md": "" });
  assert.equal(messages(root, { maxFiles: 1 })["scan-limit"], "Stopped at the 1-file bound.");
  assert.equal(messages(root, { maxTotalBytes: 5 })["scan-limit"], "Stopped at the 5-byte text bound.");
  const sizeRoot = project(t, { "b.txt": "abcd" });
  const sizeReport = auditProject({ path: sizeRoot, limits: { maxFileBytes: 3 } });
  assert.equal(sizeReport.notices.find(n => n.code === "oversized-text").message, "Skipped b.txt; it exceeds 3 bytes.");
  assert.equal(sizeReport.findings.some(f => f.code === "oversized-text"), false);

  const app = project(t, {
    "package.json": JSON.stringify({ dependencies: { "@capacitor/core": "1", "@capacitor/android": "1" } }),
    "capacitor.config.json": "{}",
  });
  assert.equal(messages(app, { maxFiles: 1, maxTotalBytes: 1024 })["metadata-limit"],
    "Artifact metadata reached its separate 1024-byte / 1-file bound; unverified folders remain in the source scan.");
});

// The collection checks the clock both before listing a directory and before inspecting each entry.
for (const [point, readsWithinLimit] of [["directory", 1], ["entry", 2]]) {
  test("the time limit keeps its finding message at the " + point + " check", t => {
    const root = project(t, { "README.md": "" });
    let reads = 0;
    t.mock.method(Date, "now", () => ++reads <= readsWithinLimit ? 0 : 20);
    assert.equal(messages(root, { maxDurationMs: 10 })["scan-limit"], "Stopped after the 10ms time bound.");
  });
}

test("unreadable project files and directories retain their exact finding messages", t => {
  const root = project(t, { "README.md": "", "closed.txt": "", "closed/item.txt": "" });
  const readDir = fs.readdirSync;
  watchFileReads(t, file => {
    if (path.basename(file) === "closed.txt") throw new Error("fixture read denied");
  });
  t.mock.method(fs, "readdirSync", (dir, ...args) => {
    if (path.basename(dir) === "closed") throw new Error("fixture listing denied");
    return readDir(dir, ...args);
  });
  assert.deepEqual(messages(root), {
    "unreadable-directory": "Could not read closed: fixture listing denied",
    "unreadable-file": "Could not read closed.txt.",
  });
});

test("escaping and unresolved links retain their exact finding messages", t => {
  // Simulate the filesystem's link responses so Windows runners need no link privileges.
  const root = project(t, { "README.md": "", "outside-link": "", "broken-link": "" });
  const realRoot = fs.realpathSync(root);
  let resolutionError = Object.assign(new Error("missing"), { code: "ENOENT" });
  const lstat = fs.lstatSync;
  const realpath = fs.realpathSync;
  t.mock.method(fs, "lstatSync", (file, ...args) => {
    if (file === path.join(realRoot, "outside-link") || file === path.join(realRoot, "broken-link")) {
      return { isSymbolicLink: () => true };
    }
    return lstat(file, ...args);
  });
  t.mock.method(fs, "realpathSync", (file, ...args) => {
    if (file === path.join(realRoot, "outside-link")) return path.dirname(realRoot);
    if (file === path.join(realRoot, "broken-link")) throw resolutionError;
    return realpath(file, ...args);
  });
  assert.deepEqual(messages(root), {
    "symlink-escape": "Refused symlink escaping the project: outside-link",
  });
  const brokenNotice = () => auditProject({ path: root }).notices.find(n => n.code === "symlink-unresolved");
  assert.equal(brokenNotice().message, "Skipped unresolved symlink (ENOENT): broken-link");
  resolutionError = new Error("no OS code");
  assert.equal(brokenNotice().message, "Skipped unresolved symlink (unresolved): broken-link");
});

test("the project finding builder retains its fallback for a missing message", () => {
  // Every current rule supplies a message, so public fixtures cannot emit this fallback.
  assert.match(fs.readFileSync(script, "utf8"), /data\.message\s*\|\|\s*"Review this evidence\."/);
});
