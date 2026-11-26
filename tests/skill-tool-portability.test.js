"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditSkillRoots } = require("../skills/audit-agent-skills/scripts/audit-skills");

function toolNotes(t, { compatibility, body = "Read the record.", files = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tool-notes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skill = path.join(root, "map-record");
  const header = ["---", "name: map-record", "description: Use when cataloguing historical maps by their location."];
  if (compatibility) header.push("compatibility: " + compatibility);
  for (const [name, content] of Object.entries({ "SKILL.md": [...header, "---", body].join("\n"), ...files })) {
    const file = path.join(skill, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return auditSkillRoots({ roots: [skill] }).skills[0].findings
    .filter(f => f.code === "model-specific-tool")
    .map(f => [f.file, f.line, f.message]);
}

test("README product names and example scripts are quiet, instruction files locate tool use", t => {
  const files = {
    "README.md": "Works in Claude Code, Codex CLI and any agent.\nAskUserQuestion",
    "scripts/sample.js": "// apply_patch",
    "references/tools.txt": "PreToolUse",
    "references/tools.markdown": "# Example\nCall exec_command.",
    "agents/openai.yaml": "interface:\n  short_description: Launch EnterPlanMode",
  };
  assert.deepEqual(toolNotes(t, { files }).sort(), [
    ["agents/openai.yaml", 2, "Model-specific capability found: EnterPlanMode"],
    ["references/tools.markdown", 2, "Model-specific capability found: exec_command"],
  ]);
});

test("target declarations in prose are quiet, undeclared real tools and hooks still report", t => {
  assert.deepEqual(toolNotes(t, { body: "Target agent: Claude Code. Also works in Codex CLI." }), []);
  for (const name of ["AskUserQuestion", "apply_patch", "request_user_input", "PreToolUse",
    "TodoWrite", "PostToolUseFailure", "PostToolUse", "write_stdin", "update_plan",
    "TaskStop", "ToolSearch", "PreSkillShellCommand", "followup_task", "wait_agent"]) {
    assert.deepEqual(toolNotes(t, { body: "Run " + name }), [
      ["SKILL.md", 5, "Model-specific capability found: " + name],
    ]);
  }
  assert.deepEqual(toolNotes(t, { body: "Read a record. Stop to check the Workflow. Edit the data." }), []);
});

test("compatibility covers only its product, including a hook supported by either product", t => {
  for (const compatibility of ["Claude Code", "OpenAI Codex CLI"]) {
    assert.deepEqual(toolNotes(t, { compatibility, body: "Observe PreToolUse." }), []);
  }
  assert.deepEqual(toolNotes(t, { compatibility: "Claude Code", body: "AskUserQuestion first.\nThen call apply_patch." }), [
    ["SKILL.md", 7, "Model-specific capability found: apply_patch"],
  ]);
  assert.deepEqual(toolNotes(t, { compatibility: "Codex", body: "apply_patch first.\nThen call AskUserQuestion." }), [
    ["SKILL.md", 7, "Model-specific capability found: AskUserQuestion"],
  ]);
  assert.deepEqual(toolNotes(t, { compatibility: "Claude Code and Codex",
    body: "Use AskUserQuestion or apply_patch." }), []);
});
