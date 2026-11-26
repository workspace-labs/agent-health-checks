"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { cliInHome } = require("./support/safety-text");

const code = "look-alike-name";
const prefix = "Name is one keystroke from another installed skill: ";
const advice = "Check that both are genuine; this compares installed skills only and knows no list of real names.";

function install(t, names) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-look-alike-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const roots = names.map((name, index) => {
    const root = path.join(home, String(index), name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "SKILL.md"), [
      "---", "name: " + name, "description: Use when arranging color swatches by their spectral wavelengths.",
      "---", "Read the record " + index + ".",
    ].join("\n"));
    return root;
  });
  return (reverse = false) => {
    const args = (reverse ? [...roots].reverse() : roots).flatMap(root => ["--root", root]);
    const result = cliInHome(home, ...args, "--json");
    assert.ok(result.status === 0 || result.status === 2, result.stderr);
    return { status: result.status, skills: JSON.parse(result.stdout).skills };
  };
}

function findings(skill) {
  return skill.findings.filter(f => f.code === code);
}

for (const [kind, first, second] of [
  ["doubled letter", "invoice-helper", "invoice-helpper"],
  ["swapped neighbours", "invoice-helper", "invoice-hepler"],
  ["digit for a letter", "invoice-helper", "invoice-he1per"],
  ["added digit", "invoice-helper", "invoice-helper1"],
  ["different replacement", "invoice-helper", "invoice-helter"],
  ["multiple folded characters", "morning-logic", "m0m1ng-l0g1c"],
  ["single non-Latin replacement", "invoice-helper", "invoice-h\u0435lper"],
  ["supplementary character insertion", "invoice-helper", "invoice-hel🐝per"],
]) {
  test("look-alike names flag both skills for " + kind, t => {
    const { skills, status } = install(t, [first, second])();
    assert.equal(skills.length, 2);
    for (const skill of skills) {
      assert.deepEqual(findings(skill), [{
        axis: "portability", severity: "review", code,
        message: prefix + (skill.name === first ? second : first), file: "SKILL.md", line: 1, suggestion: advice,
      }]);
      assert.equal(skill.axes.portability, "review");
    }
    if (!/[^\x00-\x7F]/u.test(second)) {
      assert.equal(status, 0);
      assert.ok(skills.every(s => s.status === "Needs review"));
    } else {
      assert.ok(skills.find(s => s.name === second).findings.some(f => f.code === "invalid-name"));
    }
  });
}

for (const [kind, names] of [
  ["different words", ["invoice-helper", "invoice-archiver"]],
  ["related family", ["checkflow", "weekflow", "frameflow"]],
  ["short names", ["pdf", "pptx", "alpha", "alph"]],
  ["short names with supplementary characters", ["abc🐝", "abc🐞"]],
  ["two edits after a partial fold", ["colour-list", "c0lour-lost"]],
]) {
  test("look-alike names stay quiet for " + kind, t => {
    assert.ok(install(t, names)().skills.every(s => findings(s).length === 0));
  });
}

test("identical names retain only their existing duplicate finding", t => {
  const { skills } = install(t, ["invoice-helper", "invoice-helper"])();
  assert.equal(skills.length, 2);
  for (const skill of skills) assert.deepEqual(skill.findings.map(f => f.code), ["duplicate-name"]);
});

test("each skill gets one deterministic neighbour when several names match", t => {
  const names = ["invoice-helper", "invoice-helpper", "invoice-hepler", "invoice-he1per", "invoice-helper1"];
  const scan = install(t, names);
  function neighbours(skills) {
    return skills.map(skill => {
      const hits = findings(skill);
      assert.equal(hits.length, 1);
      const other = hits[0].message.slice(prefix.length);
      if (skill.name === names[0]) assert.ok(names.slice(1).includes(other));
      else assert.equal(other, names[0]);
      return [skill.name, other];
    });
  }
  assert.deepEqual(neighbours(scan().skills), neighbours(scan(true).skills));
});

test("look-alike evidence uses the same bounded excerpt as other findings", t => {
  const first = "color-" + "a".repeat(90);
  const { skills } = install(t, [first, first + "x"])();
  for (const skill of skills) {
    const hits = findings(skill);
    assert.equal(hits.length, 1);
    const evidence = hits[0].message.slice(prefix.length);
    assert.equal(Array.from(evidence).length, 80);
    assert.match(evidence, /^color-.*…/);
    assert.ok(evidence.endsWith(skill.name === first ? "x" : "a"));
  }
});
