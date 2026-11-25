"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const checker = require.resolve("../skills/audit-project-health/scripts/audit-project");
const { auditProject } = require(checker);

function project(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-project-files-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  return root;
}

function hasFinding(root, code) {
  return auditProject({ projectPath: root }).findings.some(finding => finding.code === code);
}

test("configuration templates are ordinary files and a real environment file is flagged", t => {
  const files = { "README.md": "", "app.js": "" };
  for (const suffix of ["example", "sample", "template", "dist"]) files[".env." + suffix] = "sample\n";
  const root = project(t, files);
  assert.equal(auditProject({ projectPath: root }).status, "Healthy");
  fs.writeFileSync(path.join(root, ".env"), "fixture\n");
  const report = auditProject({ projectPath: root });
  assert.equal(report.status, "Needs attention");
  assert.deepEqual(report.findings.map(f => [f.code, f.file]), [["secret-files-present", ".env"]]);
});

test("all protected regular files stay unread and the finding identifies every path", t => {
  const names = [".env", ".npmrc", ".netrc", ".pypirc", ".git-credentials", "config/credentials.json",
    "id_ecdsa", "id_dsa", ".aws/credentials", "store.keystore", "store.jks", "public.pem", "talk.key",
    "id_rsa", "id_ed25519", "keys.pfx", "keys.p12"];
  const root = project(t, Object.fromEntries(names.map(name => [name, "PRIVATE-FIXTURE-CONTENTS"])));
  fs.writeFileSync(path.join(root, "README.md"), "readme");
  fs.writeFileSync(path.join(root, "credentials"), "ordinary");
  const watched = new Set(names.map(name => path.join(fs.realpathSync(root), name)));
  const read = [];
  const original = fs.readFileSync;
  t.mock.method(fs, "readFileSync", function(filename, ...args) {
    if (watched.has(filename)) read.push(filename);
    return original.call(this, filename, ...args);
  });
  const report = auditProject({ projectPath: root });
  assert.deepEqual(read, []);
  assert.equal(report.totalBytes, Buffer.byteLength("readme") + Buffer.byteLength("ordinary"));
  assert.equal(report.status, "Needs attention");
  assert.equal(report.findings.length, 1);
  const finding = report.findings[0];
  assert.equal(finding.code, "secret-files-present");
  assert.equal(finding.message, names.length + " secret-like files are present in the project tree; contents were not read.");
  assert.equal(finding.file, [...names].sort()[0]);
  assert.equal(finding.verify, "Confirm ignore rules and version-control status without printing secret values. Files: " + [...names].sort().join(", ") + ".");
  assert.ok(!JSON.stringify(report).includes("PRIVATE-FIXTURE-CONTENTS"));
});

test("the supported README spellings count only at the project root", t => {
  for (const name of ["README.md", "README.markdown", "rEaDmE.Md", "ReadMe.TxT", "README.RST", "readme"]) {
    const root = project(t, { [name]: "", "app.js": "" });
    assert.equal(hasFinding(root, "missing-readme"), false, name);
  }
  const root = project(t, { "docs/README.md": "", "README.md.bak": "", "README.html": "" });
  assert.equal(hasFinding(root, "missing-readme"), true);
});

test("npm shrinkwrap satisfies dependency locking and an absent lock still reports", t => {
  const manifest = JSON.stringify({ dependencies: { example: "1" }, scripts: { test: "node --test" } });
  for (const lock of ["package-lock.json", "npm-shrinkwrap.json", ""]) {
    const files = { "README.md": "", "package.json": manifest };
    if (lock) files[lock] = "{}";
    assert.equal(hasFinding(project(t, files), "missing-lockfile"), !lock, lock);
  }
});

test("only npm's placeholder and missing test commands trigger the test-script finding", t => {
  for (const [command, missing] of [
    ["node --test || exit 1", false], ["node --test", false],
    ['echo "Error: no test specified" && exit 1', true],
    ['node --test && echo "no test specified" || exit 1', false],
    [" ", true], [undefined, true],
  ]) {
    const root = project(t, { "README.md": "", "package.json": JSON.stringify({ scripts: { test: command } }) });
    assert.equal(hasFinding(root, "missing-test-script"), missing, command);
  }
});

test("desktop metadata leaves inventory, fingerprint and findings unchanged at any depth", t => {
  const root = project(t, { "README.md": "", "src/app.js": "module.exports = 1;" });
  const before = auditProject({ projectPath: root });
  for (const name of [".DS_Store", "src/Thumbs.db", "src/desktop.ini"]) {
    fs.writeFileSync(path.join(root, name), "ignored");
  }
  const after = auditProject({ projectPath: root });
  for (const key of ["digest", "fileCount", "totalBytes", "findings", "notices"]) {
    assert.deepEqual(after[key], before[key], key);
  }
  fs.writeFileSync(path.join(root, "src/app.js"), "module.exports = 2;");
  assert.notEqual(auditProject({ projectPath: root }).digest, before.digest);
});

test("Czech and Estonian audits use the same code-unit order and finding IDs", t => {
  // Czech sorts the digraph ch after h. The language-independent order puts ch first.
  const root = project(t, { "ch.js": "require('./absent');", "h.js": "require('./absent');", "README.md": "" });
  function report(locale) {
    const cli = spawnSync(process.execPath, [checker, "--path", root, "--json"], {
      encoding: "utf8", env: { ...process.env, LC_ALL: locale, LANG: locale },
    });
    assert.equal(cli.status, 0, cli.stderr);
    return JSON.parse(cli.stdout);
  }
  const cs = report("cs_CZ.UTF-8");
  const et = report("et_EE.UTF-8");
  for (const key of ["digest", "findings", "notices"]) assert.deepEqual(cs[key], et[key], key);
  assert.deepEqual(cs.findings.map(f => f.file), ["ch.js", "h.js"]);
});
