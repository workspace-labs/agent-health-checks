"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { hashTree } = require("./support/tree-fingerprint");

const skills = require.resolve("../skills/audit-agent-skills/scripts/audit-skills");
const projects = require.resolve("../skills/audit-project-health/scripts/audit-project");
const flag = process.allowedNodeEnvironmentFlags.has("--permission") ? "--permission" : "--experimental-permission";

function fixture(t) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "checker-read-only-")));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, "field-notes");
  const home = path.join(temp, "home");
  const sentinel = path.join(temp, "ran");
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "SKILL.md"), [
    "---", "name: field-notes", "description: Use when recording field observations about local plants.",
    "---", "# Notes", "Read [the sample](scripts/sample.js).",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "README.md"), "# Field notes\n");
  fs.writeFileSync(path.join(root, "scripts", "sample.js"),
    'require("node:fs").writeFileSync(process.env.TRAP_SENTINEL, "ran");\n');
  const windows = process.platform === "win32";
  const executable = windows ? "inspect.cmd" : "inspect";
  const command = windows ? '@node "%~dp0scripts\\sample.js"\r\n' :
    '#!/usr/bin/env node\nrequire("./scripts/sample.js");\n';
  fs.writeFileSync(path.join(root, executable), command, { mode: 0o755 });
  const hook = "node scripts/sample.js";
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "field-notes", main: "scripts/sample.js", bin: "./" + executable,
    scripts: { preinstall: hook, install: hook, postinstall: hook, test: "node --test" },
  }));
  return { root, sentinel, env: { ...process.env, HOME: home, USERPROFILE: home, TRAP_SENTINEL: sentinel } };
}

function run(args, fixture) {
  const result = spawnSync(process.execPath, args, {
    cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 15000,
  });
  assert.ifError(result.error);
  return result;
}

test("control detects a fired trap and a fixture content change", t => {
  const f = fixture(t);
  const before = hashTree(f.root);
  assert.equal(run(["scripts/sample.js"], f).status, 0);
  assert.equal(fs.readFileSync(f.sentinel, "utf8"), "ran");
  fs.appendFileSync(path.join(f.root, "README.md"), "Changed");
  assert.notEqual(hashTree(f.root), before);
});

for (const permissions of [false, true]) {
  for (const checker of [skills, projects]) {
    test(`${path.basename(checker)} reads the trap fixture ${permissions ? "with " + flag : "normally"}`, t => {
      const f = fixture(t);
      const args = permissions ? [flag, "--allow-fs-read=*"] : [];
      const before = hashTree(f.root);
      const option = checker === skills ? "--root" : "--path";
      const result = run([...args, checker, option, f.root, "--json"], f);
      assert.equal(result.status, 0, result.stderr + "\n" + result.stdout);
      const report = JSON.parse(result.stdout);
      if (checker === skills) {
        assert.equal(report.skills[0].name, "field-notes");
        assert.ok(report.skills[0].fileCount >= 5);
      } else {
        assert.equal(report.projectName, "field-notes");
        assert.ok(["Healthy", "Watch"].includes(report.status));
      }
      assert.equal(hashTree(f.root), before, "the checker changed the fixture");
      assert.equal(fs.existsSync(f.sentinel), false, "fixture code was executed");
    });
  }
}

test("the read-only permission invocation refuses the control write", t => {
  const f = fixture(t);
  const result = run([flag, "--allow-fs-read=*", "scripts/sample.js"], f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERR_ACCESS_DENIED/);
  assert.equal(fs.existsSync(f.sentinel), false);
});
