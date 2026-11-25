"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = require.resolve("../skills/audit-agent-skills/scripts/audit-skills");
const { auditSkillRoots } = require(script);
const directoryLink = process.platform === "win32" ? "junction" : "dir";

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hidden-skill-roots-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function install(root, ...parts) {
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), [
    "---", "name: " + path.basename(dir),
    "description: Use when recording observations on the leaf shapes of local trees.",
    "---", "Record observations.",
  ].join("\n"));
  return dir;
}

test("root header and JSON name hidden entries while visible container skills are audited", t => {
  const root = fixture(t);
  install(root, ".system", "builtin");
  install(root, ".backup-x", "old-copy");
  fs.writeFileSync(path.join(root, ".DS_Store"), "");
  install(root, "synced", ".older", "old-copy");
  install(root, "synced", ".git", "history");
  install(root, "synced", "bucket", "leaf-guide");

  const report = auditSkillRoots({ roots: [root] });
  assert.deepEqual(report.skills.map(skill => skill.name), ["leaf-guide"]);
  const omitted = [".DS_Store", ".backup-x", ".system", "synced/.git", "synced/.older"];
  assert.deepEqual(report.roots[0].notSearched, omitted);
  assert.deepEqual(report.roots[0].containers, [{ name: "synced", skills: 1 }]);
  const beforeSummary = execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" }).split("Skill Doctor")[0];
  assert.match(beforeSummary, /not searched/);
  for (const name of omitted) assert.ok(beforeSummary.includes(name), name);
});

test("a populated unfinished install never opens a skipped hidden subtree during its fallback audit", t => {
  const root = fixture(t);
  install(root, "unfinished", ".stashed", "older");
  fs.writeFileSync(path.join(root, "unfinished", "draft.txt"), "Draft");
  install(root, "only-backups", ".saved", "old");
  const visits = [];
  const readdir = fs.readdirSync;
  t.mock.method(fs, "readdirSync", (dir, ...options) => {
    if (path.relative(root, dir).split(path.sep).some(part => [".stashed", ".saved"].includes(part))) visits.push(dir);
    return readdir(dir, ...options);
  });
  const report = auditSkillRoots({ roots: [root] });
  assert.deepEqual(visits, []);
  assert.deepEqual(report.skills.map(s => [s.name, s.status, s.fileCount]), [["unfinished", "Broken", 1]]);
  assert.deepEqual(report.roots[0].notSearched, ["only-backups/.saved", "unfinished/.stashed"]);
});

test("a visible install link cannot bring a hidden skill back into a collection", t => {
  const root = fixture(t);
  const hidden = install(root, ".system", "built-in");
  const visible = install(root, "visible");
  fs.symlinkSync(hidden, path.join(root, "backdoor"), directoryLink);
  fs.symlinkSync(visible, path.join(root, ".old-link"), directoryLink);
  const report = auditSkillRoots({ roots: [root] });
  assert.deepEqual(report.skills.map(s => [s.name, s.sources.length]), [["visible", 1]]);
  assert.deepEqual(report.roots[0].notSearched, [".old-link", ".system"]);
  const explicit = auditSkillRoots({ roots: [path.join(root, ".system")] });
  assert.deepEqual(explicit.skills.map(s => s.name), ["built-in"]);
  assert.ok(!Object.hasOwn(explicit.roots[0], "notSearched"));
});

test("an identified skill still audits its own hidden content", t => {
  const root = fixture(t), skill = install(root, "visible");
  fs.mkdirSync(path.join(skill, ".tools"));
  fs.writeFileSync(path.join(skill, ".tools", "notes.txt"), "Bundle content");
  const report = auditSkillRoots({ roots: [root] });
  assert.equal(report.skills[0].fileCount, 2);
  assert.ok(!Object.hasOwn(report.roots[0], "notSearched"));
});
