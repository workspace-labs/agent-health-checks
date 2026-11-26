"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { executableImportWordStarts } = require("../skills/audit-project-health/scripts/import-context");

const skillsDirectory = path.resolve(__dirname, "../skills");
const watched = /\b(?:require|module|import|export|fs|process|globalThis|global|fetch|WebSocket|WebTransport|EventSource|XMLHttpRequest|Worker|navigator)\b/g;
const fileMethods = new Set([
  "closeSync", "constants", "fstatSync", "lstatSync", "openSync", "opendirSync",
  "readFileSync", "readSync", "readdirSync", "readlinkSync", "realpathSync", "statSync",
]);

// Reuse the checker's JS lexer to distinguish actual identifiers from comments,
// quoted examples and the many regex literals containing the names we watch.
// Its public API reports import-word positions, so mark our candidates with an
// identifier of that kind and map the positions back to the unmodified source.
function executableNames(source) {
  const positions = new Map();
  let shift = 0;
  const marked = source.replace(watched, (word, offset) => {
    positions.set(offset + shift, { word, offset });
    shift += "require".length - word.length;
    return "require";
  });
  const starts = executableImportWordStarts(marked);
  return [...positions].filter(([index]) => starts.has(index)).map(([, entry]) => entry);
}

function approvedLoad(rest, before, file, shipped) {
  if (/^require\s*\.\s*main\s*===\s*module\b/.test(rest)) return true;
  const call = /^require\s*\(\s*(["'])([^"'\\]+)\1\s*\)/.exec(rest);
  if (!call) return false;
  const name = call[2].replace(/^node:/, "");
  if (name === "fs") return /\bconst\s+fs\s*=\s*$/.test(before);
  if (name === "buffer") return /\bconst\s*\{\s*isUtf8\s*\}\s*=\s*$/.test(before);
  if (["path", "os", "crypto"].includes(name)) return true;
  if (!/^\.{1,2}\//.test(call[2])) return false;
  try {
    return shipped.has(require.resolve(path.resolve(path.dirname(file), call[2])));
  } catch {
    return false;
  }
}

function approvedFileAccess(rest) {
  if (/^fs\s*=\s*require\s*\(/.test(rest)) return true;
  const method = /^fs\s*\.\s*(\w+)/.exec(rest)?.[1];
  if (!fileMethods.has(method)) return false;
  // The readers inspect bytes with the default "r" flag. An options object
  // can override that default, so admit only their ordinary one-argument calls.
  if (method === "readFileSync") {
    return /^fs\s*\.\s*readFileSync\s*\(\s*(?:[\w$]+|path\.join\(\s*[\w$]+(?:\s*,\s*[\w$]+)*\s*\))\s*\)/.test(rest);
  }
  if (method !== "openSync") return true;
  // The shipped reader opens a named path with literal read-only flags.
  return /^fs\s*\.\s*openSync\s*\(\s*\w+\s*,\s*(?:"r"|'r'|fs\.constants\.O_RDONLY(?:\s*\|\s*fs\.constants\.O_(?:NOFOLLOW|NONBLOCK))*)\s*\)/.test(rest);
}

function policy(source, file, shipped) {
  const issues = [];
  for (const { word, offset } of executableNames(source)) {
    const rest = source.slice(offset);
    if (word === "require" && approvedLoad(rest, source.slice(0, offset), file, shipped)) continue;
    if (word === "module") {
      if (/^module\s*\.\s*exports\s*=/.test(rest)) continue;
      if (/require\s*\.\s*main\s*===\s*$/.test(source.slice(0, offset)) && /^module\s*\)/.test(rest)) continue;
    }
    if (word === "fs" && approvedFileAccess(rest)) continue;
    if (word === "process" && /^process\s*\.\s*(?:cwd\s*\(|argv\b|exit\s*\(|exitCode\b|(?:stdout|stderr)\s*\.\s*write\s*\()/.test(rest)) continue;
    issues.push("line " + (source.slice(0, offset).split("\n").length) + ": " + rest.split("\n")[0].trim());
  }
  return issues;
}

function shippedScripts(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...shippedScripts(file));
    else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) files.push(file);
  }
  return files;
}

for (const skill of ["audit-agent-skills", "audit-project-health"]) {
  test(skill + " uses read-only operations and loads only approved modules", () => {
    const shipped = new Set(shippedScripts(path.join(skillsDirectory, skill, "scripts")));
    assert.ok(shipped.size);
    for (const file of shipped) {
      assert.deepEqual(policy(fs.readFileSync(file, "utf8"), file, shipped), [], file);
    }
  });
}

test("source check controls distinguish data, ordinary reads and disallowed operations", () => {
  const file = path.join(skillsDirectory, "audit-agent-skills/scripts/audit-skills.js");
  const shipped = new Set([file]);
  const safe = [
    'const fs = require("fs"); fs.readFileSync(p);',
    'const { isUtf8 } = require("node:buffer"); require("./audit-skills");',
    'const words = "fetch() fs.writeFileSync()"; // require("node:http")',
    'const sample = /fetch\\(something\\)/;',
    'if (require.main === module) process.stdout.write("ok"); module.exports = {};',
    'const bytes = Buffer.from("field notes");',
  ];
  const unsafe = [
    'require("node:child_process").spawn("helper");', 'require("https");',
    'require("../SKILL.md");', 'require(variable);', 'import("node:net");',
    'const f = require("node:fs"); f.writeFileSync(p, s);', 'fs.unlinkSync(p);',
    'fs.openSync(p, "w");', 'fs.readFileSync(p, { flag: "w" });', 'fs["writeFileSync"](p, s);',
    'const b = require("node:buffer");', 'fetch(url);', 'new WebSocket(url);',
    'import { spawn } from "node:child_process";', 'export { request } from "https";',
    'const load = require; load("https");', 'const load = module["require"]; load("https");',
    'const { writeFileSync } = require("node:fs");', 'fs.promises.writeFile(p, s);',
    'const f = fetch;', 'process.getBuiltinModule("http");', 'globalThis["fetch"](url);',
  ];
  for (const source of safe) assert.deepEqual(policy(source, file, shipped), [], source);
  for (const source of unsafe) assert.ok(policy(source, file, shipped).length, source);
});
