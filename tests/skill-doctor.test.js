"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { auditSkillRoots } = require("../skills/audit-agent-skills/scripts/audit-skills");

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `skill-doctor-${label}-`));
}

function put(root, name, body, extras = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
  for (const [rel, value] of Object.entries(extras)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
  return dir;
}

function skillMd(name, description, body = "# Workflow\n\nFollow the bounded, read-only workflow.") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

function scan(roots, limits) {
  return auditSkillRoots({ roots: roots.map((root, i) => ({ id: `test-${i}`, label: `Test ${i + 1}`, path: root })), limits });
}

function hashTree(root) {
  const hash = crypto.createHash("sha256");
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      hash.update(path.relative(root, file));
      if (entry.isDirectory()) walk(file);
      else if (entry.isSymbolicLink()) hash.update(fs.readlinkSync(file));
      else hash.update(fs.readFileSync(file));
    }
  }
  walk(root);
  return hash.digest("hex");
}

test("valid universal skill passes all six DNA axes", () => {
  const root = tempRoot("universal");
  put(root, "clean-skill", skillMd("clean-skill", "Use when the user asks to inspect a plain text report and summarize its evidence."));
  const report = scan([root]);
  assert.equal(report.skills[0].status, "Universal");
  assert.deepEqual(report.skills[0].axes, { structure: "pass", triggers: "pass", safety: "pass", portability: "pass", claude: "pass", codex: "pass" });
});

test("separate Claude and Codex profiles produce directional readiness", () => {
  const root = tempRoot("profiles");
  put(root, "portable-helper", skillMd("portable-helper", "Use when the user asks for a portable profile demonstration."), {
    "agents/openai.yaml": "policy:\n  allow_implicit_invocation: true\n",
  });
  put(root, "claude-companion", skillMd("claude-companion", "Use when the user asks for a model naming demonstration."));
  const report = scan([root]);
  assert.equal(report.skills.find((s) => s.name === "portable-helper").status, "Claude-ready");
  assert.equal(report.skills.find((s) => s.name === "claude-companion").status, "Codex-ready");
});

test("malformed frontmatter and broken references are hard failures", () => {
  const root = tempRoot("broken");
  put(root, "bad-front", "# no frontmatter\n");
  put(root, "bad-link", skillMd("bad-link", "Use when the user asks to open a bundled compatibility reference.", "# Workflow\n\nRead [the guide](references/missing.md)."));
  const report = scan([root]);
  assert.equal(report.skills.find((s) => s.name === "bad-front").status, "Broken");
  assert.ok(report.skills.find((s) => s.name === "bad-link").findings.some((f) => f.code === "broken-reference" && f.severity === "error"));
});

test("weak triggers stay heuristic review findings", () => {
  const root = tempRoot("triggers");
  put(root, "vague-helper", skillMd("vague-helper", "Makes things nice."));
  const result = scan([root]).skills[0];
  assert.equal(result.status, "Needs review");
  assert.ok(result.findings.some((f) => f.code === "thin-description"));
  assert.ok(result.findings.some((f) => f.code === "unclear-trigger"));
});

test("different duplicates and likely trigger overlap remain visible", () => {
  const a = tempRoot("dupe-a"), b = tempRoot("dupe-b");
  const description = "Use when the user asks to compare architecture options with weighted quality evidence.";
  put(a, "decision-aid", skillMd("decision-aid", description));
  put(b, "decision-aid", skillMd("decision-aid", description, "# Workflow\n\nUse a different implementation."));
  put(a, "option-matrix", skillMd("option-matrix", "Use when the user asks to compare architecture options using weighted quality evidence."));
  const report = scan([a, b]);
  assert.equal(report.skills.filter((s) => s.name === "decision-aid").length, 2);
  assert.ok(report.skills.filter((s) => s.name === "decision-aid").every((s) => s.findings.some((f) => f.code === "duplicate-name")));
  assert.ok(report.skills.some((s) => s.findings.some((f) => f.code === "trigger-overlap")));
});

test("identical mirrors deduplicate while preserving source badges", () => {
  const a = tempRoot("mirror-a"), b = tempRoot("mirror-b");
  const content = skillMd("same-skill", "Use when the user asks to prove identical mirrors are deduplicated.");
  put(a, "same-skill", content); put(b, "same-skill", content);
  const report = scan([a, b]);
  assert.equal(report.summary.skills, 1);
  assert.equal(report.summary.mirrors, 1);
  assert.equal(report.skills[0].sources.length, 2);
});

test("risky commands are reported but never executed or rewritten", () => {
  const root = tempRoot("readonly");
  const sentinel = path.join(root, "executed.txt");
  put(root, "risky-skill", skillMd("risky-skill", "Use when the user asks to inspect a deliberately risky test fixture.", "# Workflow\n\nReview the bundled script before any action."), {
    "scripts/danger.sh": `#!/bin/sh\nrm -rf /never-run\nprintf executed > ${sentinel}\n`,
  });
  const before = hashTree(root);
  const report = scan([root]);
  const after = hashTree(root);
  assert.equal(before, after);
  assert.equal(fs.existsSync(sentinel), false);
  assert.ok(report.skills[0].findings.some((f) => f.code === "destructive-command"));
});

test("oversized and binary content is bounded and disclosed", () => {
  const root = tempRoot("limits");
  put(root, "bounded-skill", skillMd("bounded-skill", "Use when the user asks to verify bounded file and binary scanning."), {
    "assets/blob.bin": Buffer.from([0, 1, 2, 3]),
    "references/large.txt": "x".repeat(256),
  });
  const result = scan([root], { maxFileBytes: 64, maxTotalBytes: 1024, maxFiles: 20 }).skills[0];
  assert.ok(result.findings.some((f) => f.code === "oversized-file"));
});

test("symlinks escaping a declared root are refused", { skip: process.platform === "win32" }, () => {
  const root = tempRoot("symlink-root"), outside = tempRoot("symlink-outside");
  put(outside, "external-skill", skillMd("external-skill", "Use when the user asks to test a symlink boundary."));
  fs.symlinkSync(path.join(outside, "external-skill"), path.join(root, "external-skill"));
  const result = scan([root]).skills[0];
  assert.ok(result.findings.some((f) => f.code === "symlink-root-escape"));
  assert.equal(result.fileCount, 0);
});

test("broken skill symlinks are explicit safety findings", { skip: process.platform === "win32" }, () => {
  const root = tempRoot("broken-symlinks");
  const dir = put(root, "linked-skill", skillMd("linked-skill", "Use when the user asks to verify broken skill symlink handling."));
  fs.symlinkSync(path.join(dir, "references", "missing.md"), path.join(dir, "missing-reference.md"));
  fs.symlinkSync(path.join(root, "missing-skill"), path.join(root, "ghost-skill"));
  const report = scan([root]);
  const linked = report.skills.find((skill) => skill.name === "linked-skill");
  const ghost = report.skills.find((skill) => skill.name === "ghost-skill");
  assert.ok(linked.findings.some((finding) => finding.code === "symlink-unresolved" && /\(ENOENT\)/.test(finding.message)));
  assert.ok(ghost.findings.some((finding) => finding.code === "symlink-root-unresolved" && /\(ENOENT\)/.test(finding.message)));
  assert.equal(linked.axes.safety, "review");
  assert.equal(ghost.axes.safety, "review");
});

// A refused symlink used to carry an empty digest, which silently disqualified its
// finding from every evidence contract downstream (the Skill Clinic could not send
// it to Backloop at all). Refusing to read the target must not cost the card its
// identity: mint a deterministic digest instead.
test("refused root symlinks still carry a stable, unique audit digest", { skip: process.platform === "win32" }, () => {
  const root = tempRoot("symlink-digest"), outside = tempRoot("symlink-digest-outside");
  put(outside, "escaped-skill", skillMd("escaped-skill", "Use when the user asks to test a refused symlink digest."));
  fs.symlinkSync(path.join(outside, "escaped-skill"), path.join(root, "escaped-skill"));
  fs.symlinkSync(path.join(outside, "escaped-skill"), path.join(root, "second-link"));
  fs.symlinkSync(path.join(root, "missing-skill"), path.join(root, "unresolved-skill"));

  const report = scan([root]);
  const escaped = report.skills.find((skill) => skill.name === "escaped-skill");
  const second = report.skills.find((skill) => skill.name === "second-link");
  const unresolved = report.skills.find((skill) => skill.name === "unresolved-skill");

  for (const skill of [escaped, second, unresolved]) {
    assert.match(skill.digest, /^[a-f0-9]{64}$/);
    assert.equal(skill.id, `${skill.name}:${skill.digest}`);   // same shape as an audited skill
    assert.equal(skill.fileCount, 0);                          // still refused — nothing was read
  }
  // Distinct links are distinct evidence, and a refusal is never a content hash.
  assert.notEqual(escaped.digest, second.digest);
  assert.notEqual(escaped.digest, unresolved.digest);
  // Deterministic: a second audit of the same refusal mints the same identity.
  const again = scan([root]).skills.find((skill) => skill.name === "escaped-skill");
  assert.equal(again.digest, escaped.digest);
  assert.equal(again.id, escaped.id);
});
