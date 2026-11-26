"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const script = require.resolve("../skills/audit-project-health/scripts/audit-project.js");
const { auditProject } = require(script);

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "project-options-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const home = path.join(temp, "home");
  const project = path.join(home, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), "# Example\n");
  for (const key of ["HOME", "USERPROFILE"]) {
    const old = process.env[key];
    process.env[key] = home;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  function run(...args) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: temp, encoding: "utf8" });
    assert.ifError(result.error);
    return result;
  }
  return { temp, home, project, run };
}

function usageError(result, option) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const lines = result.stderr.trimEnd().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes(option), result.stderr);
  assert.match(lines[1], /^Usage: .*--path/);
}

for (const kind of ["missing folder", "ordinary file"]) {
  test("project CLI prints an Unavailable report and exits 1 for " + kind, t => {
    const { project, run } = fixture(t);
    const target = path.join(project, kind === "ordinary file" ? "README.md" : "absent");
    const result = run("--path", target, "--json");
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "Unavailable");
    assert.equal(result.status, 1);
    const [finding] = report.findings;
    assert.equal(finding.impact, "The checker cannot inspect or verify this folder.");
    assert.equal(finding.verify, "Check that --path names an existing folder you can read.");
    assert.equal(run("--path", project).status, 0);
  });
}

test("a denied project directory has the portable unavailable advice", t => {
  const { project } = fixture(t);
  t.mock.method(fs, "readdirSync", () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); });
  const report = auditProject({ projectPath: project });
  assert.equal(report.status, "Unavailable");
  assert.equal(report.findings[0].impact, "The checker cannot inspect or verify this folder.");
  assert.equal(report.findings[0].verify, "Check that --path names an existing folder you can read.");
});

test("project CLI distinguishes confirmed problems from a healthy report", t => {
  const { project, run } = fixture(t);
  assert.equal(run("--path", project).status, 0);
  fs.writeFileSync(path.join(project, "app.js"), 'require("./missing");\n');
  const result = run("--path", project, "--json");
  assert.equal(JSON.parse(result.stdout).status, "Needs attention");
  assert.equal(result.status, 2);
});

test("typos, flag values and positional arguments produce one diagnostic plus usage", t => {
  const { project, run } = fixture(t);
  assert.equal(run("--path", project, "--json").status, 0);
  for (const bad of ["--jsno", "--json=yes", "extra"]) {
    usageError(run("--path", project, bad), bad);
  }
});

test("omitted and option-shaped values cannot be mistaken for project paths or names", t => {
  const { project, run } = fixture(t);
  usageError(run(), "--path");
  for (const key of ["--path", "--name", "--id", "--profile", "--max-files", "--max-file-bytes",
    "--max-total-bytes", "--max-duration-ms"]) {
    for (const values of [[key], [key, "--json"], [key + "="], [key + "=--json"]]) {
      usageError(run("--path", project, ...values), key);
    }
  }
});

test("a repeated path cannot silently select the second project", t => {
  const { temp, project, run } = fixture(t);
  const result = run("--path", path.join(temp, "nonexistent"), "--path", project);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Duplicate option: --path\n");
});

test("all value options reject duplicates across equals and separate syntax", t => {
  const { project, run } = fixture(t);
  for (const [key, value] of [
    ["--path", project], ["--id", "example"], ["--name", "Example"], ["--profile", "workspace"],
    ["--max-files", "20"], ["--max-file-bytes", "1000"], ["--max-total-bytes", "5000"],
    ["--max-duration-ms", "2000"],
  ]) {
    const base = key === "--path" ? [] : ["--path", project];
    const result = run(...base, key + "=" + value, key, value);
    assert.equal(result.status, 1, key);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Duplicate option: " + key + "\n");
  }
});

for (const equals of [true, false]) {
  test("value options accept " + (equals ? "equals" : "separate") + " syntax", t => {
    const { project, run } = fixture(t);
    const options = [
      ["--path", project], ["--id", "cli-id"], ["--name", "My Project"], ["--profile", "workspace"],
      ["--max-files", "5"], ["--max-file-bytes", "1200"], ["--max-total-bytes", "4200"],
      ["--max-duration-ms", "2000"],
    ];
    const result = run(...options.flatMap(([key, value]) => equals ? [key + "=" + value] : [key, value]), "--json");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.projectId, "cli-id");
    assert.equal(report.projectName, "My Project");
    assert.deepEqual(report.limits, { maxFiles: 5, maxFileBytes: 1200, maxTotalBytes: 4200, maxDurationMs: 2000 });
  });
}

test("limits reject values outside positive whole decimal numbers", t => {
  const { project, run } = fixture(t);
  for (const value of ["0", "-1", "0.5", "1e2", "Infinity", "0xff", "4ms", "9007199254740993"]) {
    usageError(run("--path", project, "--max-files", value), "--max-files");
  }
});

test("help and version remain successful standalone commands", t => {
  const { run } = fixture(t);
  for (const flag of ["--help", "-h", "--version"]) {
    const result = run(flag);
    assert.equal(result.status, 0);
    assert.match(result.stdout, flag === "--version" ? /^\d+\.\d+\.\d+/ : /--max-duration-ms/);
  }
});

const refusedMessage = "This folder is too broad to audit. Name the project folder itself.";

for (const kind of ["home", "ancestor", "alias", "filesystem root"]) {
  test("module refuses the " + kind + " before listing its contents", t => {
    const { temp, home, project } = fixture(t);
    const alias = path.join(temp, "home-alias");
    if (kind === "alias") fs.symlinkSync(home, alias, "junction");
    const target = { home, ancestor: temp, alias, "filesystem root": path.parse(home).root }[kind];
    const list = fs.readdirSync;
    const listed = [];
    t.mock.method(fs, "readdirSync", (file, ...args) => {
      listed.push(file);
      if (file === fs.realpathSync(target)) throw new Error("test prevents a broad scan");
      return list(file, ...args);
    });
    const report = auditProject({ projectPath: target });
    assert.deepEqual(listed, []);
    assert.equal(report.status, "Unavailable");
    assert.equal(report.fileCount, 0);
    assert.equal(report.totalBytes, 0);
    assert.deepEqual(report.findings.map(f => [f.code, f.severity, f.confidence, f.message]), [
      ["project-root-refused", "high", "confirmed", refusedMessage],
    ]);
    assert.equal(auditProject({ projectPath: project }).status, "Healthy");
  });
}

test("CLI refuses the synthetic home and prints the reason in either format", t => {
  const { home, project, run } = fixture(t);
  fs.mkdirSync(path.join(home, ".ssh"));
  fs.writeFileSync(path.join(home, ".ssh", "config"), "test data\n");
  for (const json of [false, true]) {
    const result = run("--path", home, ...(json ? ["--json"] : []));
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(refusedMessage));
    if (json) assert.equal(JSON.parse(result.stdout).status, "Unavailable");
  }
  assert.equal(run("--path", project).status, 0);
});

test("CLI and module reject unknown profiles and accept workspace", t => {
  const { project, run } = fixture(t);
  assert.equal(auditProject({ projectPath: project, profile: "workspace" }).status, "Healthy");
  assert.equal(run("--path", project, "--profile", "workspace").status, 0);
  usageError(run("--path", project, "--profile", "other"), "other");
  for (const profile of ["other", "", null, 12]) {
    const result = auditProject({ projectPath: project, profile });
    assert.equal(result.status, "Unavailable");
    assert.equal(result.findings[0].code, "project-unavailable");
    assert.ok(result.findings[0].message.includes(String(profile)));
  }
});

test("the refusal recognizes alternate home spelling on case-insensitive volumes", t => {
  const { temp } = fixture(t);
  const otherSpelling = path.join(temp, "HOME");
  if (!fs.existsSync(otherSpelling)) return t.skip("case-sensitive volume");
  const r = auditProject({ path: otherSpelling });
  assert.deepEqual(r.findings.map(f => f.code), ["project-root-refused"]);
});
