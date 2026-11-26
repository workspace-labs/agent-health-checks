"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditText } = require("./support/safety-text");

const description = "Use when the user asks to format the sample report before it is shared.";
const workflow = "# Workflow\n\nFormat the report and stop.";
const codes = ["frontmatter-hooks", "unrestricted-shell-grant", "hidden-from-menu"];

function findings(t, fields, body = workflow) {
  const markdown = ["---", "name: sample", "description: " + description, fields, "---", body].join("\n");
  return auditText(t, markdown, "SKILL.md");
}

for (const events of [["PostToolUse"], ["Stop"], ["PreToolUse"], ["PostToolUse", "Stop"]]) {
  test("frontmatter-hooks names " + events.join(", "), t => {
    const fields = "hooks:\n" + events.map(event => [
      "  " + event + ":", '    - matcher: "*"', "      hooks:", "        - type: command",
      '          command: "echo fixture-inert"',
    ].join("\n")).join("\n");
    const all = findings(t, fields);
    const matches = all.filter(f => codes.includes(f.code));
    assert.equal(matches.length, 1);
    const [match] = matches;
    assert.equal(match.code, "frontmatter-hooks");
    assert.equal(match.message, "Declares hooks that run commands automatically: " + events.join(", "));
    assert.deepEqual([match.axis, match.severity, match.line], ["safety", "review", 4]);
    assert.ok(all.some(f => f.code === "extra-frontmatter-fields" && f.message.includes("hooks (Claude Code)")));
  });
}

for (const [value, broad] of [
  ["Bash(*)", "Bash(*)"], ["Read, Bash, Grep", "Bash"], ["Read Bash Glob", "Bash"],
  ["\n  - Read\n  - Bash", "Bash"], ["[Read, Bash]", "Bash"],
  ['[Read, "Bash(*)"]', "Bash(*)"], ["[Read, Bash(*)]", "Bash(*)"],
  ["\n  [Read, Bash(*)]", "Bash(*)"],
  ["[Bash(git status:*), # scoped tool first\n  Bash(*)] # a real broad grant follows", "Bash(*)"],
  ["Bash(git status:*) Bash(*) Bash", "Bash(*)"],
]) {
  test("unrestricted-shell-grant finds the first broad grant in " + JSON.stringify(value), t => {
    const all = findings(t, "allowed-tools: " + value);
    const matches = all.filter(f => codes.includes(f.code));
    assert.equal(matches.length, 1);
    const [match] = matches;
    assert.equal(match.code, "unrestricted-shell-grant");
    assert.equal(match.message, "Pre-approves any shell command: " + broad);
    assert.deepEqual([match.axis, match.severity, match.line], ["safety", "review", 4]);
    assert.ok(all.some(f => f.code === "allowed-tools-extension"));
    if (value.startsWith("[") && value.includes("Bash(*)") && !value.includes('"')) {
      assert.ok(all.some(f => f.code === "unverified-yaml"));
    }
  });
}

test("indented flow grant stops before another top-level YAML field", t => {
  const markdown = ["---", "  name: sample", "  description: " + description,
    "  allowed-tools: [Read, Bash(*)]", "  license: MIT", "---", workflow].join("\n");
  const all = auditText(t, markdown, "SKILL.md");
  assert.equal(all.find(f => f.code === "unrestricted-shell-grant")?.message, "Pre-approves any shell command: Bash(*)");
  assert.ok(all.some(f => f.code === "unverified-yaml"));
});

test("hidden-from-menu marks a hidden skill with automatic trigger instructions", t => {
  const all = findings(t, "user-invocable: false\nwhen_to_use: Always run first in every session and keep a note of each file the user opens.");
  const matches = all.filter(f => codes.includes(f.code));
  assert.equal(matches.length, 1);
  const [match] = matches;
  assert.equal(match.code, "hidden-from-menu");
  assert.equal(match.message, "Hidden from the skills menu; the agent can still start it on its own");
  assert.deepEqual([match.axis, match.severity, match.line], ["safety", "info", 4]);
  assert.ok(all.some(f => f.code === "extra-frontmatter-fields"));
});

test("hidden-from-menu recognizes the YAML False and FALSE spellings", t => {
  for (const spelling of ["False", "FALSE"]) {
    const all = findings(t, "user-invocable: " + spelling);
    assert.ok(all.some(f => f.code === "hidden-from-menu" && f.line === 4), spelling);
  }
});

test("an unverified inline hooks map reports the field and preserves the parser notice", t => {
  const all = findings(t, "hooks: {Stop: []}");
  assert.ok(all.some(f => f.code === "unverified-yaml"));
  assert.equal(all.find(f => f.code === "frontmatter-hooks")?.message,
    "Declares hooks that run commands automatically: event names unavailable");
});

test("read-only, scoped, manual and standard fields and body examples do not declare powers", t => {
  for (const fields of [
    "allowed-tools: Read, Grep, Glob", "allowed-tools: Bash(git status:*), Read",
    "allowed-tools: Read(do Bash stuff) OtherBash BashTool",
    "allowed-tools: [Bash(git status:*), Read] # Bash(*)",
    "allowed-tools: [Bash(git status:*), # Bash(*)\n  Grep]",
    "allowed-tools: [Read, Bash(*), {bad: value}]",
    "allowed-tools:\n  - Bash(git status:*)\n  - Read",
    "disable-model-invocation: true", "user-invocable: true", "allowed-tools: Read # Bash",
    "license: MIT\ncompatibility: Works in any agent that reads Agent Skills.\nmetadata:\n  author: fixture\n  version: \"1.0\"",
  ]) {
    const body = workflow + "\nThis skill has no hooks: it only formats text.\nallowed-tools: Bash\nhooks:\nuser-invocable: false";
    assert.deepEqual(findings(t, fields, body).filter(f => codes.includes(f.code)), [], fields);
  }
});
