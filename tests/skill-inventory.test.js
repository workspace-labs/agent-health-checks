"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = require.resolve("../skills/audit-agent-skills/scripts/audit-skills");
const { auditSkillRoots } = require(script);
const directoryLink = process.platform === "win32" ? "junction" : "dir";

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skill-inventory-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function displayed(file) {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? "~/" + file.slice(home.length + 1) : file;
}

function install(folder, name = path.basename(folder), body = "Read the attached record.") {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "SKILL.md"), [
    "---", "name: " + name, "description: Use when examining historical paper records and compiling an index.",
    "---", body, "",
  ].join("\n"));
}

function cli(cwd, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", timeout: 10000, ...options });
  assert.ifError(result.error);
  return result;
}

test("a link in another scanned root adds a marked source, regardless of root order", t => {
  const dir = fixture(t);
  const links = path.join(dir, "links"), store = path.join(dir, "store");
  fs.mkdirSync(links);
  const target = path.join(store, "paper-trail"), link = path.join(links, "paper-trail");
  install(target);
  fs.symlinkSync(target, link, directoryLink);
  for (const roots of [[links, store], [store, links]]) {
    const report = auditSkillRoots({ roots });
    assert.equal(report.summary.skills, 1);
    assert.equal(report.skills[0].status, "Universal");
    assert.equal(report.skills[0].sources.length, 2);
    assert.deepEqual(report.skills[0].sources.map(s => s.root), roots.map(displayed));
    assert.equal(report.skills[0].sources.find(s => s.path === displayed(link)).isLink, true);
    assert.ok(!Object.hasOwn(report.skills[0].sources.find(s => s.path === displayed(target)), "isLink"));
  }
});

test("a link outside all roots stays unread and cannot create a name clash", t => {
  const dir = fixture(t), store = path.join(dir, "store"), links = path.join(dir, "links");
  const target = path.join(dir, "outside", "paper-trail");
  install(target, "wrong-name");
  install(path.join(store, "paper-trail"));
  fs.mkdirSync(links);
  fs.symlinkSync(target, path.join(links, "paper-trail"), directoryLink);
  const report = auditSkillRoots({ roots: [store, links] });
  const refused = report.skills.find(s => s.fileCount === 0);
  assert.equal(refused.findings[0].message, `Refused skill symlink escaping ${displayed(links)}. Target ${displayed(target)} was not checked.`);
  assert.equal(refused.findings[0].axis, "structure");
  assert.equal(refused.axes.safety, "pass");
  assert.ok(!report.skills.some(s => s.findings.some(f => f.code === "duplicate-name")));
  assert.equal(report.skills.find(s => s.fileCount > 0).status, "Universal");
});

test("containers report their skill counts and nested broken references are judged", t => {
  const root = fixture(t);
  const inner = path.join(root, "synced", "bucket", "inner");
  const deep = path.join(root, "repo", "skills", "deep");
  install(inner, "inner", "Read [the index](absent.md).");
  install(deep);
  const report = auditSkillRoots({ roots: [root] });
  assert.deepEqual(report.roots[0].containers, [{ name: "repo", skills: 1 }, { name: "synced", skills: 1 }]);
  assert.equal(report.summary.skills, 2);
  assert.deepEqual(report.skills.map(s => s.sources[0].path).sort(), [deep, inner].map(displayed).sort());
  assert.deepEqual(report.skills.find(s => s.name === "inner").findings.filter(f => f.severity === "error").map(f => f.code), ["broken-reference"]);
  assert.equal(report.summary.statuses.broken, 1);
});

test("empty folders are ignored and a populated folder without SKILL.md stays Broken", t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "empty"));
  fs.mkdirSync(path.join(root, "unfinished"));
  fs.writeFileSync(path.join(root, "unfinished", "notes.txt"), "Work in progress.");
  const { skills } = auditSkillRoots({ roots: [root] });
  assert.deepEqual(skills.map(s => [s.name, s.status]), [["unfinished", "Broken"]]);
});

test("discovery stops at depth three, skips dependencies and history, and stops below a skill", t => {
  const root = fixture(t);
  install(path.join(root, "store", "bucket", "visible"));
  install(path.join(root, "store", "bucket", "visible", "sample"));
  install(path.join(root, "store", "one", "two", "too-deep"));
  install(path.join(root, "store", ".git", "git-sample"));
  install(path.join(root, "store", "node_modules", "dependency"));
  install(path.join(root, "node_modules", "another-dependency"));
  const { skills } = auditSkillRoots({ roots: [root] });
  assert.deepEqual(skills.map(s => s.name), ["visible"]);
});

test("a root containing its own SKILL.md is one skill", t => {
  const dir = fixture(t), root = path.join(dir, "paper-trail");
  install(root);
  for (const name of ["scripts", "references"]) fs.mkdirSync(path.join(root, name));
  const result = cli(dir, ["--root", root, "--json"]);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.skills.map(s => [s.sources[0].path, s.status]), [[displayed(root), "Universal"]]);
});

for (const wrongFirst of [false, true]) {
  test(`identical mirrors retain a wrong folder name with wrong root ${wrongFirst ? "first" : "last"}`, t => {
    const dir = fixture(t), good = path.join(dir, "first"), bad = path.join(dir, "second");
    install(path.join(good, "paper-trail"));
    install(path.join(bad, "wrong-name"), "paper-trail");
    const roots = wrongFirst ? [bad, good] : [good, bad];
    const report = auditSkillRoots({ roots });
    assert.equal(report.summary.skills, 1);
    assert.equal(report.summary.mirrors, 1);
    assert.equal(report.skills[0].status, "Broken");
    assert.deepEqual(report.skills[0].findings.map(f => f.code), ["folder-name-mismatch"]);
    assert.deepEqual(report.skills[0].sources.map(s => s.root), roots.map(displayed));
    assert.equal(cli(dir, roots.flatMap(root => ["--root", root])).status, 2);
  });
}

test("same-content folders in one root produce a duplicate-name finding and zero mirrors", t => {
  const root = fixture(t);
  install(path.join(root, "paper-trail"));
  install(path.join(root, "other-name"), "paper-trail");
  const report = auditSkillRoots({ roots: [root] });
  assert.equal(report.summary.mirrors, 0);
  assert.ok(report.skills.some(s => s.findings.some(f => f.code === "duplicate-name")));
});

test("explicit missing and non-directory roots have distinct states and exit 1", t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, "file"), "");
  for (const [name, state] of [["absent", "missing"], ["file", "not a folder"]]) {
    const result = cli(dir, ["--root", "x=" + path.join(dir, name), "--json"]);
    assert.equal(result.status, 1);
    const [root] = JSON.parse(result.stdout).roots;
    assert.equal(root.state, state);
    assert.equal(root.exists, name === "file");
  }
});

test("a directory that resolves but cannot be listed retains its unreadable flag", t => {
  const dir = fixture(t);
  const original = fs.readdirSync;
  t.mock.method(fs, "readdirSync", (file, ...args) => {
    if (file === dir) throw Object.assign(new Error("access denied"), { code: "EACCES" });
    return original(file, ...args);
  });
  const [root] = auditSkillRoots({ roots: [dir] }).roots;
  assert.equal(root.exists, true);
  assert.equal(root.unreadable, true);
  assert.equal(root.state, "unreadable");
});

test("an omitted explicit path is refused, and valid labelled and path-like equals signs work", t => {
  const dir = fixture(t), root = path.join(dir, "dir=one");
  install(path.join(root, "paper-trail"));
  for (const args of [["--root"], ["--root", "--json"], ["--root", "label="]]) {
    assert.equal(cli(dir, args).status, 1);
  }
  for (const spec of [root, "./dir=one", "sample=" + root]) {
    const result = cli(dir, ["--json", "--root", spec]);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.roots[0].path, displayed(root));
    assert.equal(report.skills[0].status, "Universal");
  }
});

test("terminal output leads with explicit root states and missing default roots stay quiet", t => {
  const dir = fixture(t);
  const result = cli(dir, ["--root", "present=" + dir, "--root", "absent=" + path.join(dir, "absent")]);
  assert.equal(result.status, 1);
  const preamble = result.stdout.split("Skills Checker")[0];
  assert.match(preamble, /present.*read/i);
  assert.match(preamble, /absent.*missing/i);
  const defaults = cli(dir, [], { env: { ...process.env, HOME: dir, USERPROFILE: dir } });
  assert.equal(defaults.status, 0);
  assert.doesNotMatch(defaults.stdout, /missing/i);
});

test("2,000 empty folders and a three-level skill finish within two seconds", t => {
  const root = fixture(t);
  for (let i = 0; i < 2000; i++) fs.mkdirSync(path.join(root, "empty-" + i));
  install(path.join(root, "repo", "skills", "deep"));
  const start = performance.now();
  const report = auditSkillRoots({ roots: [root] });
  const elapsed = performance.now() - start;
  t.diagnostic(`inventory scan ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 2000, elapsed);
  assert.deepEqual(report.skills.map(s => s.name), ["deep"]);
});

test("a symlink cycle inside a container does not prevent discovery", t => {
  const root = fixture(t), container = path.join(root, "repo");
  install(path.join(container, "skills", "deep"));
  fs.symlinkSync(container, path.join(container, "skills", "loop"), directoryLink);
  const result = cli(root, ["--root", root, "--json"], { timeout: 2000 });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).skills.map(s => s.name), ["deep"]);
});

test("hidden skill containers are listed as not searched and deep empty branches supply no Broken card", t => {
  const root = fixture(t);
  install(path.join(root, ".system", "paper-trail"));
  fs.mkdirSync(path.join(root, "empty", "one", "two", "three"), { recursive: true });
  const report = auditSkillRoots({ roots: [root] });
  assert.deepEqual(report.skills, []);
  assert.deepEqual(report.roots[0].notSearched, [".system"]);
  assert.ok(!Object.hasOwn(report.roots[0], "containers"));
});

test("an explicit in-root skill link can identify a deeper target without scanning its siblings", t => {
  const dir = fixture(t), store = path.join(dir, "store"), links = path.join(dir, "links");
  const bucket = path.join(store, "archive", "one", "two");
  const target = path.join(bucket, "paper-trail");
  install(target);
  install(path.join(bucket, "unlinked"));
  fs.mkdirSync(links);
  fs.symlinkSync(target, path.join(links, "installed"), directoryLink);
  const report = auditSkillRoots({ roots: [store, links] });
  assert.deepEqual(report.skills.map(s => s.name), ["paper-trail"]);
  assert.deepEqual(report.roots.map(r => r.skills), [1, 1]);
  assert.deepEqual(report.skills[0].sources.map(s => s.path), [target, path.join(links, "installed")].map(displayed));
  assert.equal(report.skills[0].sources[1].isLink, true);
});

test("a deep link belongs to the most specific scanned root in either root order", t => {
  const dir = fixture(t), parent = path.join(dir, "store"), nested = path.join(parent, "nested");
  const target = path.join(nested, "a", "b", "c", "paper-trail"), links = path.join(dir, "links");
  install(target);
  install(path.join(parent, "paper-trail"));
  fs.mkdirSync(links);
  fs.symlinkSync(target, path.join(links, "paper-trail"), directoryLink);
  for (const roots of [[parent, nested, links], [nested, parent, links]]) {
    const report = auditSkillRoots({ roots });
    assert.equal(report.summary.skills, 1);
    assert.equal(report.summary.mirrors, 1);
    assert.equal(report.skills[0].status, "Universal");
    assert.deepEqual(report.roots.map(root => root.skills), [1, 1, 1]);
    assert.equal(report.skills[0].sources.find(source => source.path === displayed(target)).root, displayed(nested));
  }
});
