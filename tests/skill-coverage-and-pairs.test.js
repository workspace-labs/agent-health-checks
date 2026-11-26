"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const checker = require.resolve("../skills/audit-agent-skills/scripts/audit-skills");
const { auditSkillRoots } = require(checker);
const defaultDescription = "Use when cataloguing observations about rare flower pigments.";

function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skill-coverage-")));
  const cwd = path.join(home, "project");
  fs.mkdirSync(cwd);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, cwd, env: { ...process.env, HOME: home, USERPROFILE: home } };
}

function install(dir, description = defaultDescription, body = "Read the record.") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), [
    "---", "name: " + path.basename(dir), "description: " + description, "---", body,
  ].join("\n"));
}

function child(context, args) {
  const result = spawnSync(process.execPath, args, { ...context, encoding: "utf8", timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function moduleReport(context, instrumentation) {
  const source = `
    const fs = require("node:fs"), path = require("node:path");
    const { auditSkillRoots } = require(process.argv[1]);
    ${instrumentation}
    console.log(JSON.stringify(auditSkillRoots()));
  `;
  return JSON.parse(child(context, ["-e", source, checker]));
}

test("default coverage counts named locations without reading their files or judging their skills", t => {
  const context = fixture(t);
  const { home, cwd } = context;
  const expected = new Map();
  function omitted(root, kind, childPath) {
    install(path.join(root, childPath));
    expected.set(path.join("~", path.relative(home, root)), { kind, count: 1, partial: false });
  }
  omitted(path.join(home, ".codex/skills/.system"), "hidden", "x");
  omitted(path.join(home, ".claude/plugins"), "plugin", "p/skills/y");
  for (const dir of [".claude/skills", ".agents/skills"]) omitted(path.join(cwd, dir), "project", "sample");
  for (const dir of [".gemini/skills", ".cursor/skills", ".copilot/skills", ".config/opencode/skills"]) {
    omitted(path.join(home, dir), "other-agent", "sample");
  }
  fs.writeFileSync(path.join(home, ".codex/skills/.DS_Store"), "metadata");
  const visible = path.join(home, ".codex/skills/visible");
  install(visible);
  fs.symlinkSync(visible, path.join(home, ".claude/plugins/outside"), process.platform === "win32" ? "junction" : "dir");
  const report = moduleReport(context, `
    const blocked = ${JSON.stringify(Array.from(expected.keys(), name => path.join(home, name.slice(2))))};
    for (const method of ["readFileSync", "openSync"]) {
      const original = fs[method];
      fs[method] = function(file, ...rest) {
        if (typeof file === "string" && blocked.some(dir => file.startsWith(dir + path.sep))) process.exit(90);
        return original.call(fs, file, ...rest);
      };
    }
  `);
  assert.deepEqual(report.skills.map(s => s.name), ["visible"]);
  assert.deepEqual(report.roots.find(r => r.id === "codex").notSearched, [".system"]);
  assert.deepEqual(new Map(report.coverage.map(({ path, ...entry }) => [path, entry])), expected);
  const terminal = child(context, [checker]);
  assert.match(terminal, /^Not checked$/m);
  for (const p of expected.keys()) assert.ok(terminal.split("\n").some(line => line.includes(p) && line.includes("1")), p);
  const explicit = child(context, [checker, "--root", path.join(home, ".codex/skills/.system"), "--json"]);
  assert.deepEqual(JSON.parse(explicit).skills.map(s => s.name), ["x"]);
  assert.equal("coverage" in JSON.parse(explicit), false);
});

test("one 1600 ms deadline marks unfinished and later coverage locations partial", t => {
  const context = fixture(t);
  const system = path.join(context.home, ".codex/skills/.system");
  const plugins = path.join(context.home, ".claude/plugins");
  for (const dir of [system, plugins]) install(path.join(dir, "x"));
  const report = moduleReport(context, `
    let now = 0;
    Date.now = () => now;
    // A directory enumeration consumes the whole shared allowance.
    for (const method of ["opendirSync", "readdirSync"]) {
      const original = fs[method];
      fs[method] = function(dir, ...rest) {
        if ([${JSON.stringify(system)}, ${JSON.stringify(plugins)}].includes(dir)) {
          if (now >= 1600) process.exit(91);
          now += 1600;
        }
        return original.call(fs, dir, ...rest);
      };
    }
  `);
  assert.equal(report.coverage.length, 2);
  assert.ok(report.coverage.every(entry => entry.partial && entry.count === 0));
});

test("description characters count names and descriptions per observed source in each agent's roots", t => {
  const context = fixture(t);
  const description = defaultDescription + " 🌼";
  for (const root of [".claude/skills", ".codex/skills", ".agents/skills"]) {
    install(path.join(context.home, root, "pigments"), description);
  }
  const count = Array.from("pigments" + description).length;
  const report = JSON.parse(child(context, [checker, "--json"]));
  assert.equal(report.skills.length, 1);
  assert.deepEqual(report.summary.descriptionCharacters, { claude: count, codex: count * 2 });
  const line = child(context, [checker]).split("\n").find(line => line.startsWith("Description characters"));
  assert.ok(line.includes("Claude " + count) && line.includes("Codex " + count * 2), line);
  assert.match(line, /Claude .*1%.*estimate/i);
  assert.match(line, /Codex .*2%.*8,000.*estimate/i);
  const custom = path.join(context.cwd, "sample");
  install(custom);
  const customReport = JSON.parse(child(context, [checker, "--root", "codex=" + custom, "--json"]));
  assert.equal("descriptionCharacters" in customReport.summary, false);
});

test("pre-install comparison ranks related job descriptions first, preserves clean verdicts and reports real name clashes", t => {
  const context = fixture(t), installed = path.join(context.cwd, "installed");
  const candidate = path.join(context.cwd, "incoming", "branch-notes");
  install(candidate, "Use when asked to feedback on the code changes in a branch before merging, with notes per changed line");
  install(path.join(installed, "diff-review"), "Use when asked to review a pull request diff and leave comments on the changed lines");
  const others = {
    pigments: defaultDescription,
    climate: "Use when calculating winter rainfall across mountain valleys.",
    atlas: "Use when drafting constellation maps for amateur astronomy.",
    bread: "Use when baking rye loaves in a stone oven.",
  };
  for (const [name, desc] of Object.entries(others)) install(path.join(installed, name), desc);
  const roots = ["--root", candidate, "--root", installed];
  const report = JSON.parse(child(context, [checker, ...roots, "--json"]));
  assert.equal(report.summary.statuses.universal, 6);
  assert.equal(report.summary.findings, 0);
  assert.equal(report.summary.closestPairs.length, 1);
  const top = report.summary.closestPairs[0];
  assert.deepEqual(top.names, ["branch-notes", "diff-review"]);
  assert.ok(top.score > 0 && top.score <= 1);
  assert.deepEqual(auditSkillRoots({ roots: [installed, candidate] }).summary.closestPairs, report.summary.closestPairs);
  assert.match(child(context, [checker, ...roots]), /^Closest descriptions$/m);
  install(path.join(installed, "branch-notes"), others.climate);
  const clash = JSON.parse(child(context, [checker, ...roots, "--json"]));
  assert.equal(clash.skills.filter(s => s.name === "branch-notes" && s.findings.some(f => f.code === "duplicate-name")).length, 2);
  assert.ok(clash.skills.every(s => s.findings.every(f => f.code !== "trigger-overlap")));
  const namePairs = clash.summary.closestPairs.map(pair => pair.names.join("/"));
  assert.equal(new Set(namePairs).size, namePairs.length);
});

test("running from home omits already checked personal roots from project coverage", t => {
  const context = fixture(t);
  install(path.join(context.home, ".agents/skills/pigments"));
  install(path.join(context.home, ".claude/skills/.archive/old"));
  const report = JSON.parse(child({ ...context, cwd: context.home }, [checker, "--json"]));
  assert.equal(report.summary.skills, 1);
  assert.equal(report.coverage.length, 1);
  assert.equal(report.coverage[0].kind, "hidden");
});

test("hidden non-directory links keep an otherwise empty wrapper unjudged", t => {
  const { cwd, home } = fixture(t);
  const wrapper = path.join(cwd, "wrapper"), target = path.join(home, "target");
  fs.mkdirSync(wrapper);
  fs.mkdirSync(target);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(target, path.join(wrapper, ".missing"), linkType);
  fs.renameSync(target, target + "-moved");
  if (process.platform !== "win32") {
    const file = path.join(home, "file.txt");
    fs.writeFileSync(file, "ordinary file");
    fs.symlinkSync(file, path.join(wrapper, ".file"), "file");
  }
  const report = auditSkillRoots({ roots: [cwd] });
  assert.deepEqual(report.skills, []);
  assert.equal(report.roots[0].notSearched, undefined);
});

test("coverage skips a loop to the location's parent and an alias to a counted skill", t => {
  const context = fixture(t);
  const plugins = path.join(context.home, ".claude", "plugins");
  const skill = path.join(plugins, "maps");
  install(skill);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(skill, path.join(plugins, "maps-alias"), linkType);
  const loop = path.join(plugins, "parent-loop");
  fs.symlinkSync(path.dirname(plugins), loop, linkType);

  const report = moduleReport(context, `
    // Reproduce a runtime that lists junctions as directories.
    const read = fs.Dir.prototype.readSync;
    fs.Dir.prototype.readSync = function() {
      const entry = read.call(this);
      if (entry && ["maps-alias", "parent-loop"].includes(entry.name)) {
        entry.isDirectory = () => true;
        entry.isSymbolicLink = () => false;
      }
      return entry;
    };
    // Exercise the real-path backstop when even lstat reports a plain folder.
    const lstat = fs.lstatSync;
    fs.lstatSync = (file, ...args) => file === ${JSON.stringify(loop)}
      ? fs.statSync(file, ...args) : lstat(file, ...args);
  `);
  assert.deepEqual(report.coverage, [
    { path: path.join("~", ".claude", "plugins"), kind: "plugin", count: 1, partial: false },
  ]);
});

test("unrelated skills leave the closest descriptions list empty in both outputs", t => {
  const context = fixture(t);
  install(path.join(context.cwd, "a"), "plan a garden");
  install(path.join(context.cwd, "b"), "convert currency rates");
  const args = [checker, "--root", context.cwd];
  assert.deepEqual(JSON.parse(child(context, [...args, "--json"])).summary.closestPairs, []);
  assert.match(child(context, args), /^Closest descriptions: none$/m);
});
