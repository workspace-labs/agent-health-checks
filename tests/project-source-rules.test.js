"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditProject } = require("../skills/audit-project-health/scripts/audit-project");

function audit(t, source, pkg = {}, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-source-rules-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, contents] of Object.entries({
    "README.md": "", "package-lock.json": "{}",
    "package.json": JSON.stringify({ scripts: { test: "node --test" }, ...pkg }),
    "src/tool.js": source, ...files,
  })) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return auditProject({ projectPath: root });
}

const electron = { dependencies: { electron: "1" } };
const risky = ["electron-context-isolation", "electron-node-integration", "electron-sandbox-disabled", "electron-web-security"];
for (const [label, source, expected] of [
  ["warning comment", "new BrowserWindow({webPreferences:{nodeIntegration:false, contextIsolation:true}}); // never use nodeIntegration:true or contextIsolation:false", []],
  ["quoted warning", "const note = 'BrowserWindow nodeIntegration:true sandbox:false';", []],
  ["unrelated sandbox option", "require('electron'); new BrowserWindow({}); startTask({sandbox:false});", []],
  ["plain options", "new BrowserWindow({webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,webSecurity:false}});", risky],
  ["quoted options", "new BrowserWindow({'webPreferences':{'nodeIntegration':true,'contextIsolation':false,'sandbox':false,'webSecurity':false}});", risky],
  ["options assigned separately", "const wp={}; wp.contextIsolation=false; wp.nodeIntegration=true; wp.sandbox=false; wp.webSecurity=false; new BrowserWindow({webPreferences:wp});", risky],
  ["shorthand preferences", "const webPreferences={sandbox:false}; new BrowserWindow({webPreferences});", ["electron-sandbox-disabled"]],
  ["bracket preferences", "const opts={}; opts['webPreferences']={}; opts['webPreferences'].sandbox=false; new BrowserWindow(opts);", ["electron-sandbox-disabled"]],
  ["quoted assignment", "const opts={}; opts.webPreferences={}; opts.webPreferences['sandbox']=false; new BrowserWindow(opts);", ["electron-sandbox-disabled"]],
  ["separate member settings", "const config={}; config.window={}; config.window.sandbox=false; new BrowserWindow({webPreferences:config.window});", ["electron-sandbox-disabled"]],
  ["different member settings", "const config={sandbox:false,window:{sandbox:true}}; new BrowserWindow({webPreferences:config.window});", []],
  ["separate settings object", "const prefs={sandbox:false}; new BrowserWindow({webPreferences:prefs});", ["electron-sandbox-disabled"]],
]) {
  test("Electron settings: " + label, t => {
    const report = audit(t, source, electron);
    assert.deepEqual(report.findings.map(f => f.code).sort(), expected);
    assert.equal(report.status, expected.length ? "Needs attention" : "Healthy");
  });
}

for (const name of ["public/manifest.json", "manifest.webmanifest", "public/site.webmanifest"]) {
  test("a lone " + name + " is not PWA tooling", t => {
    const report = audit(t, "", {}, { [name]: "{}" });
    assert.ok(!report.stack.includes("PWA"));
    assert.equal(report.status, "Healthy");
  });
  test("PWA tooling accepts " + name, t => {
    const report = audit(t, "", { dependencies: { workbox: "1" } }, { [name]: "{}" });
    assert.ok(report.stack.includes("PWA"));
    assert.deepEqual(report.findings.map(f => f.code), ["pwa-missing-worker"]);
  });
}

for (const [label, source, matches] of [
  ["comments", "// eval(value);\n/* new Function(value) */", 0],
  ["quoted text", "'eval(value)'; \"new Function(value)\"; `eval(value)`;", 0],
  ["methods", "page.$eval('h1', callback); obj.eval(value); obj?.eval(value);", 0],
  ["live code", "eval(value); new Function(value);", 2],
  ...["window", "globalThis", "self", "global"].map(name => [
    "direct " + name + ".eval", name + " /* receiver */ .eval(value);", 1,
  ]),
  ["indirect zero-comma call", "(0, /* reference */ eval)(value);", 1],
  ["indirect call as an if body", "if (ready) (0, eval)(value);", 1],
  ["nested global lookalikes", "obj.window.eval(value); obj?.globalThis.eval(value); obj.self.eval(value); obj.global.eval(value);", 0],
  ["comma lookalikes", "(0, eval); (0, obj.eval)(value); deliver(0, eval)(value);", 0],
  ["global and indirect calls in text", "// window.eval(value)\n'(0, eval)(value)'; /* self.eval(value) */", 0],
  ["live template expression", "const result = `value: ${eval(value)}`;", 1],
]) {
  test("dynamic code: " + label, t => {
    const report = audit(t, source);
    const messages = report.findings.map(f => f.message);
    assert.deepEqual(messages, matches ? [matches + " dynamic code execution primitive" + (matches === 1 ? " was" : "s were") + " found."] : []);
  });
}

const logs = "console.log('output');\n".repeat(5);
for (const [label, source, pkg, reportsLogs] of [
  ["node shebang", "#!/usr/bin/env node\n" + logs, {}, false],
  ["require.main entry", "if (require.main === module) { run(); }\n" + logs, {}, false],
  ["bin string", logs, { bin: "./src/tool.js" }, false],
  ["named bin", logs, { bin: { report: "./src/tool.js" } }, false],
  ["scripts command", logs, { scripts: { test: "node --test", run: "node './src/tool.js' --report" } }, false],
  ["ordinary application module", logs, {}, true],
  ["commented main and file used as data", "// require.main === module\n" + logs, { scripts: { test: "cat src/tool.js" } }, true],
]) {
  test("command-line output: " + label, t => {
    const report = audit(t, source, pkg);
    assert.deepEqual(report.findings.map(f => f.code), reportsLogs ? ["debug-residue"] : []);
  });
}

for (const call of [
  "eval?.(x)", "(0, eval)?.(x)",
  ...["window", "globalThis", "self", "global"].flatMap(name => [
    name + '["eval"](x)', name + "['eval'](x)", name + ".eval?.(x)",
    name + "?.eval?.(x)", name + '?.["eval"]?.(x)',
  ]),
]) {
  test("dynamic code in executable source only: " + call, t => {
    const inert = ["// " + call, "/* " + call + " */", JSON.stringify(call) + ";", "`" + call + "`;"].join("\n");
    assert.deepEqual(audit(t, inert).findings, []);
    const findings = audit(t, inert + "\n" + call).findings;
    assert.deepEqual(findings.map(f => [f.code, f.line, f.message]), [
      ["dynamic-code-execution", 5, "1 dynamic code execution primitive was found."],
    ]);
  });
}

test("bracket and optional calls on unrelated objects stay quiet", t => {
  const source = [
    'obj["eval"](x); obj.eval?.(x); page.$eval(x);',
    'obj?.window?.eval?.(x); obj.window["eval"](x); fn(0, eval)?.(x);',
  ].join("\n");
  assert.deepEqual(audit(t, source).findings, []);
});
