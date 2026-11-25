"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditSkillRoots } = require("../skills/audit-agent-skills/scripts/audit-skills");

const description = "Use when checking the length and portability of fields in a skill.";
function scan(t, fields = [], name = "field-check", desc = description) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-fields-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = /^[a-z0-9-]+$/.test(name) ? name : "field-check";
  fs.mkdirSync(path.join(root, folder));
  const lines = ["---", "name: " + name, "description: " + desc, ...fields, "---", "Read the fields."];
  fs.writeFileSync(path.join(root, folder, "SKILL.md"), lines.join("\n"));
  return auditSkillRoots({ roots: [root] }).skills[0];
}

test("allowed-tools carries the experimental shared-field note", t => {
  assert.deepEqual(scan(t).findings, []);
  const skill = scan(t, ["allowed-tools: Read"]);
  assert.equal(skill.statusKey, "review");
  assert.deepEqual(skill.findings.map(f => [f.code, f.message]), [
    ["allowed-tools-extension", "The Agent Skills specification marks allowed-tools as experimental"],
  ]);
});

test("one portability note attributes each extra top-level field and ignores metadata keys", t => {
  const metadata = ["license: MIT", "compatibility: Any shell", "metadata:", "  model: custom", "  example-field: example"];
  assert.deepEqual(scan(t, metadata).findings, []);
  const skill = scan(t, [...metadata, "model: inherit", "context: fork", "agent: Explore", "example-field: x"]);
  assert.equal(skill.statusKey, "review");
  assert.deepEqual(skill.findings.map(f => [f.code, f.axis, f.line, f.message]), [
    ["extra-frontmatter-fields", "portability", 9,
      "Fields outside the Agent Skills specification: model (Claude Code), context (Claude Code), agent (Claude Code), example-field (product unconfirmed)"],
  ]);
  const opaqueValue = scan(t, ["model: !custom inherit"]);
  assert.equal(opaqueValue.findings.find(f => f.code === "extra-frontmatter-fields")?.message,
    "Fields outside the Agent Skills specification: model (Claude Code)");
});

test("compatibility counts Unicode characters and reports the field line above 500", t => {
  const atLimit = "🌱".repeat(500);
  assert.deepEqual(scan(t, ["compatibility: " + atLimit]).findings, []);
  for (const overLimit of [atLimit + "a", "a".repeat(600)]) {
    const skill = scan(t, ["compatibility: " + overLimit]);
    assert.equal(skill.statusKey, "broken");
    assert.deepEqual(skill.findings.map(f => [f.code, f.severity, f.line, f.message]), [
      ["compatibility-too-long", "error", 4, "Compatibility exceeds the 500-character limit"],
    ]);
  }
});

test("Claude upload description finding explains the local display of angle brackets", t => {
  assert.deepEqual(scan(t, [], "field-check", description + " Read [input] and [output].").findings, []);
  for (const fragment of ["<input> and <output>", "x < y", "y > x"]) {
    const skill = scan(t, [], "field-check", description + " Compare " + fragment + ".");
    assert.equal(skill.statusKey, "codex");
    assert.deepEqual(skill.findings.map(f => [f.code, f.severity, f.line, f.message]), [
      ["claude-description-angle-bracket", "review", 3,
        "Claude uploads reject angle brackets in the description. Claude Code accepts them and displays &lt; and &gt;."],
    ]);
  }
});

test("Claude upload name finding explains the local fallback to a valid folder name", t => {
  assert.deepEqual(scan(t).findings, []);
  for (const name of ["field<x", "field>x"]) {
    const skill = scan(t, [], name);
    const notes = skill.findings.filter(f => f.axis === "claude");
    assert.deepEqual(notes.map(f => [f.code, f.severity, f.line, f.message]), [
      ["claude-name-angle-bracket", "review", 2,
        "Claude uploads reject angle brackets in the name. Claude Code rejects this frontmatter name. The skill can still load under a valid folder name."],
    ]);
  }
});

test("Claude reserved words match only complete hyphen-separated name segments", t => {
  for (const name of ["claude-notes", "notes-anthropic", "one-claude-two"]) {
    assert.ok(scan(t, [], name).findings.some(f => f.code === "claude-reserved-name"), name);
  }
  for (const name of ["claudette", "anthropics", "a.claude.b"]) {
    assert.ok(!scan(t, [], name).findings.some(f => f.code === "claude-reserved-name"), name);
  }
});
