"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");
const { createPathProbe } = require("../skills/audit-project-health/scripts/project-paths");

function fixture(t) {
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "doctor-resolve-")));
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
  const root = path.join(outer, "project");
  function put(name, content = "") {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  }
  put("README.md", "# Import resolution\n");
  return { root, put };
}

function check(root, missing) {
  const findings = auditProject({ projectPath: root }).findings.filter(f => f.code === "broken-relative-import");
  assert.deepEqual(findings.map(f => f.message).sort(),
    missing.map(spec => "Relative import does not resolve: " + spec).sort());
  assert.ok(findings.every(f => f.confidence === "confirmed" && f.severity === "high"));
}

test("type and value imports from TypeScript resolve declaration-only files", t => {
  const { root, put } = fixture(t);
  put("types.d.ts", "export declare class Thing {}");
  put("main.ts", [
    "import type { Thing } from './types';",
    "import { Thing as Value } from './types';",
    "import { Absent } from './gone';",
  ].join("\n"));
  put("runtime.js", "require('./types');");
  check(root, ["./gone", "./types"]);
});

test("folder imports follow the folder manifest's main, with genuine misses retained", t => {
  const { root, put } = fixture(t);
  put("lib/package.json", '{"main":"entry"}');
  put("lib/entry.js");
  put("broken/package.json", '{"main":"gone.js"}');
  put("app.js", "require('./lib');\nrequire('./broken');");
  check(root, ["./broken"]);
});

test("native addon imports resolve files and folder index files", t => {
  const { root, put } = fixture(t);
  put("addon.node");
  put("binding/index.node");
  put("app.js", "require('./addon');\nrequire('./binding');\nrequire('./gone');");
  check(root, ["./gone"]);
});

test("an uncollected folder manifest leaves its import unverified", t => {
  const { root, put } = fixture(t);
  put("dist/package.json", '{"main":"app.js"}');
  put("dist/app.js");
  put("app.js", "require('./dist');");
  const report = auditProject({ projectPath: root });
  assert.deepEqual(report.findings.filter(f => f.code === "broken-relative-import"), []);
  assert.deepEqual(report.notices.filter(n => n.code === "import-not-checked").map(n => n.message),
    ["Could not check relative import ./dist in app.js."]);
});

test("relative imports outside the scan use exact names without reading target contents", t => {
  const { root, put } = fixture(t);
  const target = put("../shared/money.js", "throw new Error('fixture must never run');");
  put("app.js", "require('../shared/money');\nrequire('../shared/Money');\nrequire('../shared/gone');");
  const original = fs.readFileSync;
  const outsideReads = [];
  t.mock.method(fs, "readFileSync", function (name, ...args) {
    if (typeof name === "string" && path.dirname(name) === path.dirname(target)) outsideReads.push(name);
    return original.call(this, name, ...args);
  });
  check(root, ["../shared/Money", "../shared/gone"]);
  assert.deepEqual(outsideReads, []);
});

test("imports resolve internal file and directory links and refuse links crossing the project boundary",
  { skip: process.platform === "win32" }, t => {
    const { root, put } = fixture(t);
    put("internal/value.js");
    put("../shared/value.js");
    fs.symlinkSync("internal/value.js", path.join(root, "alias.js"));
    fs.symlinkSync("internal", path.join(root, "folder"));
    fs.symlinkSync("../shared", path.join(root, "escape"));
    fs.symlinkSync("../project/internal", path.join(root, "../shared/reentry"));
    put("app.js", [
      "require('./alias');", "require('./folder/value');", "require('./escape/value');",
      "require('./escape/reentry/value');", "require('./folder/gone');",
    ].join("\n"));
    check(root, ["./escape/value", "./escape/reentry/value", "./folder/gone"]);
  });

test("absolute internal links resolve through the spelling used to open the project",
  { skip: process.platform === "win32" }, t => {
    const { root, put } = fixture(t);
    const requested = root + "-alias";
    fs.symlinkSync(root, requested);
    put("internal/value.js");
    fs.symlinkSync(path.join(requested, "internal/value.js"), path.join(root, "alias.js"));
    put("app.js", "require('./alias');\nrequire('./absent');");
    check(requested, ["./absent"]);
  });

test("one audit spends at most 1,024 metadata lookups and still uses cached answers", t => {
  const { root, put } = fixture(t);
  const targets = Array.from({ length: 1024 }, (_, index) => "./dist/part-" + index + "/app.js");
  for (const target of targets) put(target);
  put("run.js", [...targets, targets[0]].map(target => "require('" + target + "');").join("\n"));
  const readDir = fs.readdirSync;
  let distListings = 0;
  t.mock.method(fs, "readdirSync", function (dir, options) {
    if (dir === path.join(root, "dist") || dir.startsWith(path.join(root, "dist") + path.sep)) distListings++;
    return readDir.call(this, dir, options);
  });
  const report = auditProject({ projectPath: root });
  // The root listing uses one slot. dist and its children share the other 1,023.
  assert.equal(distListings, 1023);
  assert.deepEqual(report.findings.filter(f => f.code === "broken-relative-import"), []);
  assert.deepEqual(report.notices.filter(n => n.code === "import-not-checked").map(n => n.message),
    targets.slice(-2).map(target => "Could not check relative import " + target + " in run.js."));
});

test("repeated metadata checks read a link only once per audit",
  { skip: process.platform === "win32" }, t => {
    const { root, put } = fixture(t);
    put("internal/app.js");
    const alias = path.join(root, "alias");
    fs.symlinkSync("internal", alias);
    const linkReads = t.mock.method(fs, "readlinkSync");
    const probe = createPathProbe(root);
    for (const name of ["app.js", "missing", "app.js"]) {
      assert.equal(probe(path.join(alias, name)), name === "app.js");
    }
    assert.equal(linkReads.mock.callCount(), 1);
  });

test("a sibling link cannot prove an external import is missing", { skip: process.platform === "win32" }, t => {
  const { root, put } = fixture(t);
  const target = put("../shared/target.js");
  const alias = path.join(path.dirname(target), "alias.js");
  fs.symlinkSync("target.js", alias);
  put("app.js", "require('../shared/alias');");
  const readLink = t.mock.method(fs, "readlinkSync");
  const report = auditProject({ projectPath: root });
  assert.deepEqual(report.findings.filter(f => f.code === "broken-relative-import"), []);
  assert.deepEqual(report.notices.filter(n => n.code === "import-not-checked").map(n => n.message),
    ["Could not check relative import ../shared/alias in app.js."]);
  assert.ok(readLink.mock.calls.every(call => call.arguments[0] !== alias));
});
