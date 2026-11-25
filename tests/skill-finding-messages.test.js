"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { auditSkillRoots } = require("../skills/audit-agent-skills/scripts/audit-skills");

function temp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skill-messages-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function put(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const description = "Use when arranging color swatches by their spectral wavelengths.";
function guide(name, desc = description, body = "Read the file.") {
  return `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;
}

function scan(root, limits) {
  return auditSkillRoots({ roots: [root], limits }).skills;
}

function check(skill, expected) {
  assert.ok(skill, "expected a skill in the report");
  const pairs = skill.findings.map(f => [f.code, f.message]);
  const wanted = Object.entries(expected).flatMap(([code, messages]) =>
    [].concat(messages).map(message => [code, message]));
  assert.deepEqual(pairs.sort(), wanted.sort(), skill.folder);
}

function display(file) {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? "~" + file.slice(home.length) : file;
}

test("skill findings retain their frontmatter, name, length and trigger messages", t => {
  const root = temp(t);
  put(root, "absent/notes.txt", "Installation without instructions.");
  put(root, "no-front/SKILL.md", "plain text");
  put(root, "no-end/SKILL.md", "---\nname: no-end");
  put(root, "incomplete/SKILL.md", "---\nother: value\n---\n");
  const longName = "X".repeat(65);
  put(root, "wrong/SKILL.md", guide(longName, "I sort."));
  put(root, "oversized/SKILL.md", guide("oversized", "Use when " + "x".repeat(1024), "Line.\n".repeat(500) + "End."));
  const skills = Object.fromEntries(scan(root).map(skill => [skill.folder, skill]));
  check(skills.absent, { "missing-skill-md": "The skill directory has no readable SKILL.md" });
  check(skills["no-front"], { "malformed-frontmatter": "SKILL.md must begin with YAML frontmatter" });
  check(skills["no-end"], { "malformed-frontmatter": "YAML frontmatter is not closed with ---" });
  check(skills.incomplete, {
    "missing-name": "Frontmatter is missing name",
    "missing-description": "Frontmatter is missing description",
    "empty-body": "SKILL.md has no instruction body",
    "extra-frontmatter-fields": "Fields outside the Agent Skills specification: other (product unconfirmed)",
  });
  check(skills.wrong, {
    "name-too-long": "Skill name exceeds 64 characters",
    "invalid-name": "Name must use lowercase letters, digits, and single hyphens",
    "folder-name-mismatch": `Frontmatter name '${longName}' does not match folder 'wrong'`,
    "thin-description": "Description is too short to express both capability and trigger conditions",
    "unclear-trigger": "Description does not clearly say when this skill should trigger",
    "description-voice": "Description should be written as a neutral third-person capability",
  });
  check(skills.oversized, {
    "description-too-long": "Description exceeds the 1024-character compatibility limit",
    "long-body": "SKILL.md body is 501 lines; progressive disclosure is recommended below 500",
  });
});

test("skill findings retain their reference, safety and agent profile messages", t => {
  const root = temp(t);
  const skill = path.join(root, "claude-notes");
  put(skill, "SKILL.md", [
    "---", "name: claude-notes", "description: " + description, "allowed-tools: Read", "---",
    "[outside](../outside.md)", "[absent](missing.md)", "Maps live under /Users/alice", "apply_patch",
  ].join("\n"));
  put(skill, "scripts/run.sh", "dd if=source");
  put(skill, "scripts/run.js", "eval(command); fetch(url);");
  put(skill, "references/extra/notes.md", "text\n".repeat(101));
  put(skill, "agents/openai.yaml", "default_prompt: Read notes\ndependencies:\n  - type: sample\n");
  check(scan(root)[0], {
    "claude-reserved-name": "Claude reserves 'anthropic' and 'claude' in custom skill names",
    "allowed-tools-extension": "The Agent Skills specification marks allowed-tools as experimental",
    "unverified-reference": "Could not verify reference: ../outside.md",
    "broken-reference": "Referenced file does not exist: missing.md",
    "deep-reference": "Reference is nested more than one level: references/extra/notes.md",
    "reference-no-toc": "Long reference has no contents section: references/extra/notes.md",
    "personal-path": "Machine- or workspace-specific path found: /Users/alice",
    "model-specific-tool": "Model-specific capability found: apply_patch",
    "destructive-command": "Potentially destructive command appears in skill content",
    "code-execution": "Bundled code contains an execution primitive: eval(",
    "network-access": "Potential network access found: fetch(",
    "openai-yaml-interface": "agents/openai.yaml has no interface block",
    "openai-default-prompt": "Codex default_prompt does not explicitly mention this skill",
    "declared-dependency": "Codex-specific tool dependencies are declared in agents/openai.yaml",
    "unsupported-dependency-type": "Unknown Codex dependency type: sample",
  });
});

test("skill findings retain their duplicate-name and trigger-overlap messages", t => {
  const first = temp(t), second = temp(t);
  put(first, "swatches/SKILL.md", guide("swatches"));
  put(second, "swatches/SKILL.md", guide("swatches", description, "Read the chart."));
  put(first, "palette/SKILL.md", guide("palette"));
  const { skills } = auditSkillRoots({ roots: [first, second] });
  const shared = "Likely trigger overlap with 'swatches' (100% token overlap)";
  assert.equal(skills.length, 3);
  for (const skill of skills) {
    check(skill, skill.name === "palette" ? { "trigger-overlap": [shared, shared] } : {
      "duplicate-name": "2 different skills share the name 'swatches'",
      "trigger-overlap": "Likely trigger overlap with 'palette' (100% token overlap)",
    });
  }
});

test("skills scan forwards exact size, budget and unreadable-path messages to findings", t => {
  const root = temp(t);
  const skill = path.join(root, "swatches");
  put(skill, "SKILL.md", guide("swatches"));
  put(skill, "large.txt", "x".repeat(256));
  check(scan(root, { maxFileBytes: 200 })[0], {
    "oversized-file": "Skipped large.txt; it exceeds 200 bytes",
    "unread-files": "Files not read because of scan limits: 1",
  });
  check(scan(root, { maxFiles: 0, maxTotalBytes: 1000 })[0], {
    "scan-limit": "Stopped at the bounded scan limit (0 files / 1000 bytes)",
    "unread-files": "Files not read because of scan limits: 1",
  });

  // Inject the read errors so this works even when the test account can read every file.
  const blocked = path.join(skill, "blocked");
  fs.mkdirSync(blocked);
  const list = fs.readdirSync, read = fs.readFileSync;
  t.mock.method(fs, "readdirSync", (file, ...args) => {
    if (file === blocked) throw new Error("fixture read error");
    return list(file, ...args);
  });
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (file === path.join(skill, "large.txt")) throw new Error("fixture read error");
    return read(file, ...args);
  });
  check(scan(root)[0], {
    "unreadable-directory": `Could not read ${display(blocked)}: fixture read error`,
    "unreadable-file": "Could not read large.txt",
  });
});

test("skills scan retains each distinct message for nested and root symlinks", t => {
  const root = temp(t), outside = temp(t);
  const skill = path.join(root, "swatches");
  put(skill, "SKILL.md", guide("swatches"));
  const target = path.join(skill, "target");
  const moved = path.join(outside, "will-move");
  fs.mkdirSync(target);
  fs.mkdirSync(moved);
  // Directory junctions exercise the link branches on Windows without special privileges.
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(target, path.join(skill, "inside"), linkType);
  fs.symlinkSync(outside, path.join(skill, "outside"), linkType);
  fs.symlinkSync(outside, path.join(root, "outside-link"), linkType);
  fs.symlinkSync(moved, path.join(skill, "dangling"), linkType);
  fs.symlinkSync(moved, path.join(root, "dangling-link"), linkType);
  fs.renameSync(moved, path.join(outside, "moved"));

  const dangling = path.join(skill, "dangling"), danglingRoot = path.join(root, "dangling-link");
  function assertLinkFindings(errorCode) {
    const skills = Object.fromEntries(scan(root).map(s => [s.folder, s]));
    check(skills["outside-link"], {
      "symlink-root-escape": `Refused skill symlink escaping ${display(root)}. Target ${display(outside)} was not checked.`,
    });
    check(skills["dangling-link"], {
      "symlink-root-unresolved": `Refused unresolved skill symlink (${errorCode})`,
    });
    check(skills.swatches, {
      "symlink-skipped": [
        `Skipped symlink: ${display(path.join(skill, "inside"))}`,
        `Refused symlink escaping its root: ${display(path.join(skill, "outside"))}`,
      ],
      "symlink-unresolved": `Skipped unresolved symlink (${errorCode}): ${display(dangling)}`,
    });
  }
  // The OS supplies this part of the message. Also exercise the checker's own fallback.
  let code;
  assert.throws(() => fs.realpathSync(dangling), error => {
    code = error.code;
    return Boolean(code);
  });
  assertLinkFindings(code);
  const realpath = fs.realpathSync;
  t.mock.method(fs, "realpathSync", (file, ...args) => {
    if (file === dangling || file === danglingRoot) throw new Error("no operating system code");
    return realpath(file, ...args);
  });
  assertLinkFindings("unresolved");
});
