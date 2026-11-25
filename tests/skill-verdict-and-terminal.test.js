"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const script = require.resolve("../skills/audit-agent-skills/scripts/audit-skills.js");
const projectScript = require.resolve("../skills/audit-project-health/scripts/audit-project.js");
const { auditSkillRoots } = require(script);

function fixture(t, { name = "map-guide", description = "Use when preparing a collection of topographical maps.", fields = [], body = "Prepare the maps.", files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const guide = ["---", "name: " + name, "description: " + description, ...fields, "---", body].join("\n");
  for (const [relative, contents] of Object.entries({ "SKILL.md": guide, ...files })) {
    const file = path.join(root, name, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return root;
}

function cli(entry, args, status) {
  const run = spawnSync(process.execPath, [entry, ...args], { encoding: "utf8" });
  assert.ifError(run.error);
  assert.equal(run.status, status, run.stderr);
  return run.stdout;
}

const policy = { "agents/openai.yaml": "policy:\n  allow_implicit_invocation: true\n" };
const risk = { "scripts/run.sh": 'rm -rf "$OUT"\ncurl https://example.invalid/a\n' };
for (const [label, options, safeStatus] of [
  ["control", {}, "universal"],
  ["personal path", { body: "Maps live under /Users/alice/maps." }, "workspace"],
  ["Codex policy", { files: policy }, "universal"],
  ["Claude name", { name: "claude-map-guide" }, "codex"],
  ["Codex profile note", { files: { "agents/openai.yaml": "unused: value\n" } }, "claude"],
  ["missing reference", { body: "[maps](missing.md)" }, "broken"],
]) {
  test("verdict precedence with and without script safety findings: " + label, t => {
    for (const unsafe of [true, false]) {
      const files = { ...options.files, ...(unsafe ? risk : {}) };
      const root = fixture(t, { ...options, files });
      const [skill] = auditSkillRoots({ roots: [root] }).skills;
      assert.equal(skill.statusKey, unsafe && safeStatus !== "broken" ? "review" : safeStatus);
      assert.equal(skill.findings.some(f => f.axis === "safety"), unsafe);
    }
  });
}

test("terminal leads with safety, groups repeat codes, prints advice, and counts omitted findings", t => {
  const body = Array.from({ length: 9 }, (_, i) => "[absent](missing-" + i + ".md)").join("\n");
  const root = fixture(t, {
    name: "claude-map", description: "I sort.", fields: ["allowed-tools: Read"],
    body: body + "\nMaps live under /Users/alice/maps.\napply_patch\n",
    files: {
      "scripts/run.sh": 'rm -rf "$OUT"\n',
      "references/deeper/chart.md": "text\n".repeat(101),
      "agents/openai.yaml": "unused: true\n",
    },
  });
  const [skill] = auditSkillRoots({ roots: [root] }).skills;
  assert.equal(skill.findings.length, 20);
  assert.equal(skill.findings.filter(f => f.axis === "safety").length, 1);
  const report = cli(script, ["--root", root], 2);
  const displayed = report.split("\n").filter(line => /^  (ERROR|REVIEW) /.test(line));
  assert.match(displayed[0], /safety.*Potentially destructive command/);
  const groups = new Map();
  for (const f of skill.findings) {
    if (!groups.has(f.code)) groups.set(f.code, []);
    groups.get(f.code).push(f);
  }
  let represented = 0;
  for (const line of displayed) {
    const group = [...groups.values()].find(items => line.includes(items[0].message));
    assert.ok(group, line);
    assert.ok(line.includes(group[0].suggestion), line);
    if (group.length > 1) assert.ok(line.includes("×" + group.length), line);
    represented += group.length;
  }
  assert.ok(represented < skill.findings.length);
  assert.ok(report.includes((skill.findings.length - represented) + " findings not shown"));
});

test("skill terminal makes separators, controls and direction marks visible while JSON keeps the original evidence", t => {
  const root = fixture(t, { name: "maps\u200eguide", body: "[record](maps%0A%09%0D%C2%85%E2%80%A8%E2%80%A9%E2%81%A6.md)" });
  const label = "archive\u202e";
  const args = ["--root", label + "=" + root];
  const json = JSON.parse(cli(script, [...args, "--json"], 2));
  const quoted = "maps\n\t\r\u0085\u2028\u2029\u2066.md";
  assert.equal(json.roots[0].label, label);
  assert.equal(json.skills[0].name, "maps\u200eguide");
  assert.ok(json.skills[0].findings.some(f => f.message.includes(quoted)));
  const report = cli(script, args, 2);
  assert.ok(report.includes("archive\\u202e"));
  assert.ok(report.includes("maps\\u200eguide"));
  assert.ok(report.includes("maps\\u000a\\u0009\\u000d\\u0085\\u2028\\u2029\\u2066.md"));
  assert.doesNotMatch(report, /[\r\t\u0085\u200e\u2028\u2029\u202e\u2066]/u);
});

test("project terminal preserves each report line and JSON preserves names, paths and quoted references", t => {
  const root = fixture(t, { files: { "src/a\u2066.js": "require('./map\u200f.js');\n" } });
  const args = ["--path", root, "--name", "maps\narchive\u061c"];
  const json = JSON.parse(cli(projectScript, [...args, "--json"], 0));
  assert.equal(json.projectName, "maps\narchive\u061c");
  assert.ok(json.findings.some(f => f.file.includes("a\u2066.js") && f.message.includes("map\u200f.js")));
  const report = cli(projectScript, args, 0);
  assert.ok(report.includes("maps\\u000aarchive\\u061c"));
  assert.ok(report.includes("map\\u200f.js"));
  assert.ok(report.includes("a\\u2066.js"));
  assert.doesNotMatch(report, /[\u200f\u2066\u061c]/u);
});
