"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { auditSkillRoots } = require("../skills/audit-agent-skills/scripts/audit-skills");

const verdicts = [
  { word: "Universal", key: "universal", findings: [] },
  { word: "Claude-ready", key: "claude", agentConfig: "unused: true", findings: ["openai-yaml-interface"] },
  { word: "Codex-ready", key: "codex", name: "claude-atlas", findings: ["claude-reserved-name"] },
  { word: "Workspace-specific", key: "workspace", body: "Read maps in /Users/alice/maps.", findings: ["personal-path"] },
  { word: "Needs review", key: "review", fields: ["allowed-tools: Read"], findings: ["allowed-tools-extension"] },
  { word: "Broken", key: "broken", body: "[Read the atlas](missing.md)", findings: ["broken-reference"] },
];

for (const { word, key, name = "atlas", body = "Arrange the maps.", fields = [], agentConfig, findings } of verdicts) {
  test("skills verdict and summary agree for " + word, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-verdict-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "SKILL.md"), [
      "---", "name: " + name, "description: Use when arranging historic maps by their place of origin.",
      ...fields, "---", body,
    ].join("\n"));
    if (agentConfig) {
      fs.mkdirSync(path.join(dir, "agents"));
      fs.writeFileSync(path.join(dir, "agents", "openai.yaml"), agentConfig);
    }

    const { skills, summary } = auditSkillRoots({ roots: [root] });
    assert.equal(skills.length, 1);
    assert.equal(skills[0].status, word);
    assert.equal(skills[0].statusKey, key);
    assert.deepEqual(skills[0].findings.map(item => item.code), findings);
    assert.equal(summary.skills, 1);
    assert.equal(summary.mirrors, 0);
    assert.equal(summary.findings, findings.length);
    const statuses = { universal: 0, claude: 0, codex: 0, workspace: 0, review: 0, broken: 0 };
    statuses[key] = 1;
    assert.deepEqual(summary.statuses, statuses);
  });
}
