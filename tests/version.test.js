"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repo = path.join(__dirname, "..");
const skills = path.join(repo, "skills/audit-agent-skills/scripts/audit-skills.js");
const projects = path.join(repo, "skills/audit-project-health/scripts/audit-project.js");
const { auditSkillRoots } = require(skills);
const { auditProject } = require(projects);

test("both standalone checkers and every report use the latest changelog version", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checker-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputs = [skills, projects].map((script) =>
    execFileSync(process.execPath, [script, "--version"], { encoding: "utf8", cwd: root }).trimEnd()
  );
  const changelog = fs.readFileSync(path.join(repo, "CHANGELOG.md"), "utf8");
  const release = changelog.match(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}\r?$/m);
  assert.ok(release, "expected a dated release heading");
  assert.deepEqual(outputs, [release[1], release[1]]);
  assert.equal(auditSkillRoots({ roots: [root] }).checkerVersion, release[1]);
  assert.equal(auditProject({ path: root }).checkerVersion, release[1]);
  assert.equal(auditProject({ path: path.join(root, "missing") }).checkerVersion, release[1]);
});
