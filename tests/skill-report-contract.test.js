"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = require.resolve("../skills/audit-agent-skills/scripts/audit-skills");
const api = require(script);
const axes = ["structure", "triggers", "safety", "portability", "claude", "codex"];

function tempDirectory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-report-contract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function install(root, name, description, body = "Read the record.") {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const lines = ["---", "name: " + name, "description: " + description, "---", "", body, ""];
  fs.writeFileSync(path.join(dir, "SKILL.md"), lines.join("\n"));
  return dir;
}

function keys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

test("skills module exports its synchronous API and six axes", () => {
  keys(api, ["auditSkillRoots", "parseFrontmatter", "overlapScore", "AXES", "DEFAULT_LIMITS"]);
  for (const name of ["auditSkillRoots", "parseFrontmatter", "overlapScore"]) {
    assert.equal(typeof api[name], "function");
  }
  assert.deepEqual(api.AXES, axes);
});

test("skills JSON preserves finding identity across identical installations", (t) => {
  const dir = tempDirectory(t);
  const roots = ["first", "second"].map((id) => ({ id, label: id, path: path.join(dir, id) }));
  const name = "paper-trail";
  const description = "Use when documenting a historical paper collection.";
  const body = "Read [the index](missing.md).";
  for (const root of roots) {
    const installed = install(root.path, name, description, body);
    fs.writeFileSync(path.join(installed, "notes.txt"), "Archive\n");
  }
  const report = api.auditSkillRoots({ roots });
  keys(report, ["schemaVersion", "checkerVersion", "generatedAt", "readOnly", "disclaimer", "roots", "summary", "skills"]);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.readOnly, true);
  assert.equal(new Date(report.generatedAt).toISOString(), report.generatedAt);
  assert.deepEqual(report.summary, {
    skills: 1, mirrors: 1, findings: 1,
    statuses: { broken: 1, review: 0, workspace: 0, claude: 0, codex: 0, universal: 0 },
  });

  const [skill] = report.skills;
  keys(skill, ["id", "name", "folder", "description", "body", "frontmatter", "digest", "fileCount",
    "totalBytes", "sources", "findings", "axes", "status", "statusKey", "counts"]);
  assert.equal(skill.body, body);
  assert.deepEqual(skill.findings, [{
    axis: "structure", severity: "error", code: "broken-reference",
    message: "Referenced file does not exist: missing.md", file: "SKILL.md", line: 6,
    suggestion: "Add the file or correct the relative path.",
  }]);
  // Known SHA-256 for these two relative names in code-unit order and their LF content.
  assert.equal(skill.digest, "233656d02fadbd5c122050333304ec59018496157b8504dc000b4b9c092bae32");
  assert.equal(skill.id, name + ":" + skill.digest);
  const expectedRoots = roots.map((root) => ({
    ...root, path: root.path.startsWith(os.homedir() + path.sep) ? "~" + root.path.slice(os.homedir().length) : root.path,
  }));
  assert.deepEqual(report.roots, expectedRoots.map((root) => ({ ...root, exists: true, skills: 1, state: "read" })));
  assert.deepEqual(skill.sources, expectedRoots.map((root) => ({
    id: root.id, label: root.label, root: root.path, path: path.join(root.path, name),
    skillMd: path.join(root.path, name, "SKILL.md"),
  })));
});

test("skills report emits all six status keys, labels, axis grades and finding severities", (t) => {
  const root = tempDirectory(t);
  install(root, "color-guide", "Use when drafting a watercolor pigment catalogue.");
  install(root, "map-drawer", "Use when tracing elevation contours across valleys.", "Read /Users/alice/maps.");
  const schedules = install(root, "schedule", "Use when calculating calendar availability for appointments.");
  fs.mkdirSync(path.join(schedules, "agents"));
  fs.writeFileSync(path.join(schedules, "agents", "openai.yaml"), "unused: true\n");
  install(root, "claude-helper", "Use when examining atmospheric pressure records.");
  install(root, "notes", "Use for notes.");
  fs.mkdirSync(path.join(root, "unfinished"));
  fs.writeFileSync(path.join(root, "unfinished", "notes.txt"), "Draft.");
  const { skills, summary } = api.auditSkillRoots({ roots: [root] });
  const statuses = Object.fromEntries(skills.map((s) => [s.name, [s.statusKey, s.status]]));
  assert.deepEqual(statuses, {
    "color-guide": ["universal", "Universal"],
    "map-drawer": ["workspace", "Workspace-specific"],
    "schedule": ["claude", "Claude-ready"],
    "claude-helper": ["codex", "Codex-ready"],
    "notes": ["review", "Needs review"],
    "unfinished": ["broken", "Broken"],
  });
  assert.deepEqual(summary.statuses, { universal: 1, claude: 1, codex: 1, workspace: 1, review: 1, broken: 1 });
  for (const skill of skills) keys(skill.axes, axes);
  assert.deepEqual([...new Set(skills.flatMap((s) => Object.values(s.axes)))].sort(), ["fail", "pass", "review"]);
  assert.deepEqual([...new Set(skills.flatMap((s) => s.findings.map((f) => f.severity)))].sort(), ["error", "review"]);
});

test("skills CLI exits 0 for a completed review, 2 for Broken, and 1 on argument failure", (t) => {
  const root = tempDirectory(t);
  function run(...args) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.ifError(result.error);
    return result;
  }
  install(root, "notes", "Use for notes.");
  const scan = ["--root", "sample=" + root, "--json"];
  const review = run(...scan);
  assert.equal(review.status, 0);
  assert.equal(JSON.parse(review.stdout).summary.statuses.review, 1);
  fs.mkdirSync(path.join(root, "unfinished"));
  fs.writeFileSync(path.join(root, "unfinished", "notes.txt"), "Draft.");
  const broken = run(...scan);
  assert.equal(broken.status, 2);
  assert.equal(JSON.parse(broken.stdout).summary.statuses.broken, 1);
  const failure = run("--unknown");
  assert.equal(failure.status, 1);
  assert.equal(failure.stderr.trim(), "Skill Doctor failed: Unknown option: --unknown");
});
