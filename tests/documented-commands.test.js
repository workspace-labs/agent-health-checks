"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function readInstructions(skill) {
  const skillMd = fs.realpathSync(path.join(__dirname, "..", "skills", skill, "SKILL.md"));
  const text = fs.readFileSync(skillMd, "utf8");
  const link = text.match(/\[bundled scanner\]\(([^)]+)\)/);
  assert.ok(link, "instructions must identify the bundled scanner");
  const skillDir = path.dirname(skillMd);
  const checker = fs.realpathSync(path.join(skillDir, link[1]));
  assert.ok(checker.startsWith(skillDir + path.sep), "scanner must belong to the trusted skill");
  const commands = [...text.matchAll(/^[ \t]*```bash\r?\n([\s\S]*?)^[ \t]*```/gm)]
    .flatMap(block => block[1].trim().split(/\r?\n/).map(line => line.trim()));
  return { checker, commands };
}

function run(command, cwd, env) {
  assert.match(command, /^node "\$CHECKER"(?: --root "collection=\$COLLECTION"| --path "\$PROJECT")?(?: --json)?$/);
  // Run the published command with the same shell variables on both platforms.
  const windows = process.platform === "win32";
  const shell = windows ? "powershell.exe" : "/bin/sh";
  const args = windows ? ["-NoProfile", "-NonInteractive", "-Command",
    '$CHECKER=$env:CHECKER; $PROJECT=$env:PROJECT; $COLLECTION=$env:COLLECTION; ' +
    command + '; exit $LASTEXITCODE'] : ["-c", command];
  const result = spawnSync(shell, args, { cwd, env, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command}\n${result.stderr}`);
  return result.stdout;
}

function writeSkill(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use when the user asks to summarize the evidence in a text report.\n---\n\n# Read the report\n`);
}

test("published skill commands run the bundled checkers from either working directory", t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "documented commands "));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const home = path.join(temp, "home");
  const collection = path.join(temp, "sample collection");
  writeSkill(path.join(home, ".claude", "skills"), "default-sample");
  writeSkill(collection, "explicit-sample");

  const unrelated = path.join(temp, "empty folder");
  const project = path.join(temp, "sample project");
  fs.mkdirSync(unrelated);
  fs.mkdirSync(path.join(project, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), '{"name":"sample","main":"missing.js"}');
  for (const file of ["audit-skills.js", "audit-project.js"]) {
    fs.writeFileSync(path.join(project, "scripts", file), 'console.log("fixture script");\n');
  }

  const skills = readInstructions("audit-agent-skills");
  const projects = readInstructions("audit-project-health");
  const env = { ...process.env, HOME: home, USERPROFILE: home,
    COLLECTION: fs.realpathSync(collection), PROJECT: fs.realpathSync(project),
    PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH };
  assert.equal(skills.commands.length, 3);
  assert.equal(projects.commands.length, 2);
  for (const cwd of [unrelated, project]) {
    const skillReports = skills.commands.map(cmd => run(cmd, cwd, { ...env, CHECKER: skills.checker }));
    assert.match(skillReports[0], /Skill Doctor[^\n]*1 unique skills/);
    assert.match(skillReports[0], /default-sample/);
    assert.equal(JSON.parse(skillReports[1]).skills[0].name, "default-sample");
    assert.equal(JSON.parse(skillReports[2]).skills[0].name, "explicit-sample");

    const projectReports = projects.commands.map(cmd => run(cmd, cwd, { ...env, CHECKER: projects.checker }));
    assert.match(projectReports[0], /Needs attention/);
    assert.match(projectReports[0], /missing\.js/);
    const report = JSON.parse(projectReports[1]);
    assert.equal(report.status, "Needs attention");
    assert.ok(report.findings.some(f => f.message.includes("missing.js")));
  }
});
