"use strict";

const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const checker = require.resolve("../../skills/audit-agent-skills/scripts/audit-skills");

const header = "---\nname: sample\ndescription: Use when arranging color swatches by their spectral wavelengths.\n---\n";

function cliInHome(home, ...args) {
  const report = spawnSync(process.execPath, [checker, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8",
  });
  assert.ifError(report.error);
  return report;
}

function auditText(t, content, relative = "notes.txt") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-safety-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "sample");
  const file = path.join(folder, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (relative !== "SKILL.md") fs.writeFileSync(path.join(folder, "SKILL.md"), header + "Read carefully.");
  else if (!/^\uFEFF?---\r?\n/.test(content)) content = header + content;
  fs.writeFileSync(file, content);
  const report = cliInHome(root, "--root", folder, "--json");
  assert.ok(report.status === 0 || report.status === 2, report.stderr);
  return JSON.parse(report.stdout).skills[0].findings.filter(f => f.file === relative);
}

module.exports = { auditText, cliInHome };
