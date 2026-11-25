"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const script = require.resolve("../skills/audit-agent-skills/scripts/audit-skills");
const { auditSkillRoots } = require(script);

const desc = "Use when arranging color swatches by their spectral wavelengths.";
const header = "name: swatches\ndescription: " + desc;
const wrap = yaml => "---\n" + yaml + "\n---\nRead the instructions.";

function fixture(t, raw, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "swatches");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "SKILL.md"), raw);
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, "agents"));
    fs.writeFileSync(path.join(dir, "agents", "openai.yaml"), config);
  }
  return root;
}

function scan(t, yaml, config) {
  return auditSkillRoots({ roots: [fixture(t, wrap(yaml), config)] }).skills[0];
}

for (const [label, source, result] of [
  ["plain", desc, desc],
  ["double quotes with colon", '"Use when sorting colors: arrange swatches by their wavelengths."', "Use when sorting colors: arrange swatches by their wavelengths."],
  ["single quotes and comment", "'Use when sorting someone''s color swatches into wavelength order.' # note", "Use when sorting someone's color swatches into wavelength order."],
  ["indented plain text", "\n  Use when arranging color swatches\n  by their spectral wavelengths.", desc],
  ["wrapped plain text", "Use when arranging color swatches\n  by their spectral wavelengths.", desc],
  ["folded block", ">-\n  Use when arranging color swatches\n  by their spectral wavelengths.", desc],
  ["literal block", "|-\n  Use when arranging color swatches\n  by their spectral wavelengths.", "Use when arranging color swatches\nby their spectral wavelengths."],
]) {
  test("reads " + label + " in the skill description", t => {
    const skill = scan(t, "name: swatches\ndescription: " + source);
    assert.deepEqual(skill.findings, []);
    assert.equal(skill.description, result);
  });
}

test("reads metadata maps and simple lists, preserving key scope", t => {
  const skill = scan(t, header + "\nmetadata:\n  author: Ada\n  preferences:\n    author: Bob\n    topics:\n      - colors\n      - 'maps: regional'");
  assert.deepEqual(skill.findings, []);
  assert.deepEqual(JSON.parse(JSON.stringify(skill.frontmatter.metadata)), {
    author: "Ada", preferences: { author: "Bob", topics: ["colors", "maps: regional"] },
  });
});

for (const [label, yaml, line] of [
  ["plain colon followed by a space", "name: swatches\ndescription: Use when sorting swatches: arrange these in order.", 3],
  ["duplicate key", header + "\nname: swatches", 4],
  ["duplicate nested key", header + "\nmetadata:\n  author: Ada\n  author: Bob", 6],
  ["indentation tab", header + "\nmetadata:\n\tauthor: Ada", 5],
  ["stray top-level text", header + "\nstray line", 4],
]) {
  test("reports invalid YAML and source line for " + label, t => {
    const skill = scan(t, yaml);
    assert.equal(skill.statusKey, "broken");
    assert.deepEqual(skill.findings.map(f => [f.code, f.severity, f.message, f.line]), [
      ["invalid-yaml", "error", "frontmatter is not valid YAML", line],
    ]);
  });
}

test("marks unsupported YAML for review without guessing its contents", t => {
  const skill = scan(t, header + "\nmetadata: &settings {a: b}");
  assert.equal(skill.statusKey, "review");
  assert.deepEqual(skill.findings.map(f => [f.code, f.message, f.line]), [
    ["unverified-yaml", "frontmatter could not be verified", 4],
  ]);
});

for (const [label, config] of [
  ["interface", 'interface:\n  default_prompt: "Use $swatches when selecting colors."'],
  ["policy", "policy:\n  allow_implicit_invocation: false"],
]) {
  test("accepts documented " + label + " on its own", t => {
    const skill = scan(t, header, config);
    assert.equal(skill.statusKey, "universal");
    assert.deepEqual(skill.findings, []);
  });
}

test("checks every entry of a dependency list with accurate source lines", t => {
  const config = ["dependencies:", "  tools:", "    - type: mcp", "      value: first",
    "    - type: unknown", "      value: second", "    - type: unknown", "      value: third"].join("\n");
  const skill = scan(t, header, config);
  assert.equal(skill.findings.some(f => f.code === "openai-yaml-interface"), false);
  assert.equal(skill.findings.filter(f => f.code === "declared-dependency").length, 1);
  assert.deepEqual(skill.findings.filter(f => f.code === "unsupported-dependency-type").map(f => [f.line, f.message]), [
    [5, "Unknown Codex dependency type: unknown"], [7, "Unknown Codex dependency type: unknown"],
  ]);
});

for (const [label, config, code, message, line] of [
  ["invalid", "policy:\n  allow_implicit_invocation: true\n  allow_implicit_invocation: false", "invalid-yaml", "agents/openai.yaml is not valid YAML", 3],
  ["unsupported", "policy: *defaults", "unverified-yaml", "agents/openai.yaml could not be verified", 1],
]) {
  test("reports " + label + " agent YAML with its line", t => {
    const skill = scan(t, header, config);
    assert.deepEqual(skill.findings.map(f => [f.code, f.file, f.line, f.message]), [[code, "agents/openai.yaml", line, message]]);
  });
}

test("finishes a one MiB skill with an unclosed block and opening brackets in under one second", t => {
  const root = fixture(t, "---\n" + "[".repeat(1024 * 1024 - 4));
  const start = performance.now();
  const run = spawnSync(process.execPath, [script, "--root", root, "--json"], { encoding: "utf8", timeout: 1000, maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(run.error);
  assert.equal(run.status, 2);
  assert.ok(performance.now() - start < 1000);
  assert.ok(JSON.parse(run.stdout).skills[0].findings.some(f => f.code === "malformed-frontmatter"));
});

test("reads flow lists containing quoted commas, plain values, or a trailing comma", t => {
  const fields = header + '\nmetadata:\n  tags: ["colors", \'red, blue\', greens,]';
  const skill = scan(t, fields);
  assert.deepEqual(skill.findings, []);
  assert.deepEqual(skill.frontmatter.metadata.tags, ["colors", "red, blue", "greens"]);
});

test("reads an indentationless YAML list and the following sibling key", t => {
  const fields = header + "\nmetadata:\n  colors:\n  - red\n  - blue\n  author: Ada";
  const skill = scan(t, fields);
  assert.deepEqual(skill.findings, []);
  assert.deepEqual(skill.frontmatter.metadata.colors, ["red", "blue"]);
  assert.equal(skill.frontmatter.metadata.author, "Ada");
});

test("an unsupported value does not hide a later known syntax error", t => {
  const skill = scan(t, header + "\nmetadata: &example {a: b}\nlicense: active: pending");
  assert.equal(skill.statusKey, "broken");
  assert.deepEqual(skill.findings.map(f => [f.code, f.line]), [["invalid-yaml", 5]]);
});

test("an unsupported mapping key does not invent a missing required field", t => {
  const skill = scan(t, "name: swatches\n'description': " + desc);
  assert.ok(["universal", "review"].includes(skill.statusKey));
  assert.equal(skill.findings.some(f => f.code === "missing-description"), false);
});

test("an unresolved merge field leaves required values unverified", t => {
  const skill = scan(t, "name: swatches\n<<: *defaults");
  assert.equal(skill.statusKey, "review");
  assert.deepEqual(skill.findings.map(f => [f.code, f.line]), [["unverified-yaml", 3]]);
});

test("the public frontmatter reader marks invalid or unsupported documents as unsuccessful", () => {
  const { parseFrontmatter } = require(script);
  for (const contents of [header + "\nname: swatches", header + "\nmetadata: &ref {field: value}"]) {
    assert.equal(parseFrontmatter(wrap(contents)).ok, false);
  }
});

test("a dependency with no recognizable type is reported at that entry", t => {
  const config = ["dependencies:", "  tools:", "    - type: mcp", "      value: available",
    "    - value: missing", "    - type: [mcp, another]", "    - scalar"].join("\n");
  const skill = scan(t, header, config);
  assert.deepEqual(skill.findings.filter(f => f.code === "unsupported-dependency-type").map(f => [f.line, f.message]), [
    [5, "Unknown Codex dependency type: (missing)"], [6, "Unknown Codex dependency type: (non-scalar)"],
    [7, "Unknown Codex dependency type: (missing)"],
  ]);
});

const indentedDescription = "Use when exploring color: a comparison of pigments.";
for (const [label, value] of [
  ["indented quoted scalar", '\n  "' + indentedDescription + '"'],
  ["indented block indicator", "\n  >-\n    " + indentedDescription],
]) {
  test("accepts an " + label + " as a field value", t => {
    const skill = scan(t, "name: swatches\ndescription:" + value);
    assert.deepEqual(skill.findings, []);
    assert.equal(skill.description, indentedDescription);
  });
}

test("a tab within literal block content survives decoding", t => {
  const plain = "Use when exploring pigments and color arrangements.";
  const skill = scan(t, "name: swatches\ndescription: |-\n  " + plain + "\n  \tSwatches.");
  assert.deepEqual(skill.findings, []);
  assert.equal(skill.description, plain + "\n\tSwatches.");
});

test("wrapped plain scalars keep consecutive blank lines as paragraph breaks", t => {
  const skill = scan(t, "name: swatches\ndescription:\n  Use when exploring pigments and color arrangements.\n\n\n  Compare these swatches.");
  assert.deepEqual(skill.findings, []);
  assert.equal(skill.description, "Use when exploring pigments and color arrangements.\n\nCompare these swatches.");
});
