"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { comparePath, displayPath, inside, sourceLocation } = require("./skill-paths");
const { finding } = require("./skill-findings");
const { refusedSymlinkDigest } = require("./skill-files");

function inspectRoot(root) {
  const report = { ...root, path: displayPath(root.path), exists: false, skills: 0, state: "unreadable" };
  let real;
  try {
    real = fs.realpathSync(root.path);
    report.exists = true;
    if (!fs.statSync(real).isDirectory()) {
      report.unreadable = true;
      report.state = "not a folder";
    } else {
      const entries = fs.readdirSync(real, { withFileTypes: true });
      report.state = "read";
      return { root, real, entries, report };
    }
  } catch (error) {
    if (report.exists) report.unreadable = true;
    if (error.code === "ENOENT" || error.code === "ENOTDIR") report.state = "missing";
  }
  return { root, real, report };
}

function hasGuide(entries) {
  return entries.some(entry => entry.name === "SKILL.md" && (entry.isFile() || entry.isSymbolicLink()));
}

function discoveryDirectory(name) {
  return !name.startsWith(".") && name !== "node_modules";
}

function isFolder(entry, file) {
  if (!entry.isSymbolicLink()) return entry.isDirectory();
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

function discoverInstalls(context, add, links) {
  const { root, real, entries, report } = context;
  if (hasGuide(entries)) {
    add(context, root.path, real);
    return;
  }

  function recordHidden(dir) {
    (report.notSearched ||= []).push(path.relative(root.path, dir).split(path.sep).join("/"));
  }

  function search(dir, realDir, depth, result) {
    let children;
    try { children = fs.readdirSync(realDir, { withFileTypes: true }); }
    catch { result.unreadable = true; return; }
    if (hasGuide(children)) {
      add(context, dir, realDir);
      result.skills++;
      return;
    }
    for (const entry of children) {
      if (entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) {
        if (isFolder(entry, path.join(realDir, entry.name))) recordHidden(path.join(dir, entry.name));
      } else if (!entry.isDirectory()) {
        result.populated = true;
      } else if (depth < 3 && discoveryDirectory(entry.name)) {
        search(path.join(dir, entry.name), path.join(realDir, entry.name), depth + 1, result);
      }
    }
  }

  for (const entry of entries) {
    const dir = path.join(root.path, entry.name);
    if (entry.name.startsWith(".")) {
      if (isFolder(entry, dir)) recordHidden(dir);
      continue;
    }
    if (!discoveryDirectory(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      links.push({ context, dir });
    } else if (entry.isDirectory()) {
      const realDir = path.join(real, entry.name);
      const result = { skills: 0, populated: false, unreadable: false };
      search(dir, realDir, 1, result);
      if (result.skills && !context.locations.has(realDir)) {
        (report.containers ||= []).push({ name: entry.name, skills: result.skills });
      } else if (!result.skills && (result.populated || result.unreadable)) {
        add(context, dir, realDir, 2);
      }
    }
  }
  if (report.containers) report.containers.sort((a, b) => comparePath(a.name, b.name));
  if (report.notSearched) report.notSearched.sort(comparePath);
}

function countSkillNames(folder, deadline) {
  let count = 0, partial = false;
  let rootReal;
  const pending = [folder];
  while (pending.length && Date.now() < deadline) {
    let directory;
    try {
      const current = pending.pop();
      if (current === folder) {
        rootReal = fs.realpathSync.native(folder);
      } else {
        // On Windows a junction can appear as an ordinary directory in a listing.
        if (fs.lstatSync(current).isSymbolicLink()) continue;
        const real = fs.realpathSync.native(current);
        const expected = path.join(rootReal, path.relative(folder, current));
        // Skip escapes as well as aliases to directories already inside this location.
        if (!inside(rootReal, real) || path.relative(expected, real) !== "") continue;
      }
      directory = fs.opendirSync(current);
      while (Date.now() < deadline) {
        const entry = directory.readSync();
        if (!entry) break;
        if (entry.isDirectory()) pending.push(path.join(directory.path, entry.name));
        else if (entry.isFile() && entry.name === "SKILL.md") count++;
      }
      if (Date.now() >= deadline) partial = true;
    } catch {
      partial = true;
    } finally {
      if (directory) directory.closeSync();
    }
  }
  return { count, partial: partial || pending.length > 0 };
}

function uncheckedLocations(contexts) {
  const deadline = Date.now() + 1600;
  const locations = new Map();
  const checkedRoots = new Set(contexts.map(context => context.real).filter(Boolean));
  function add(folder, kind) {
    if (locations.has(folder)) return;
    let entry;
    try {
      entry = fs.lstatSync(folder);
      if (!isFolder(entry, folder) || checkedRoots.has(fs.realpathSync(folder))) return;
    } catch { return; }
    // A linked directory is a visible location, but its target is outside this walk.
    const result = entry.isSymbolicLink() ? { count: 0, partial: true } : countSkillNames(folder, deadline);
    locations.set(folder, { path: displayPath(folder), kind, ...result });
  }
  for (const { root, entries } of contexts) {
    for (const entry of entries || []) {
      if (entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) {
        add(path.join(root.path, entry.name), "hidden");
      }
    }
  }
  add(path.join(os.homedir(), ".claude", "plugins"), "plugin");
  for (const name of [".claude", ".agents"]) add(path.join(process.cwd(), name, "skills"), "project");
  for (const name of [".gemini", ".cursor", ".copilot", ".config/opencode"]) add(path.join(os.homedir(), name, "skills"), "other-agent");
  return Array.from(locations.values()).sort((a, b) => comparePath(a.path, b.path));
}

function refusedLink(context, dir, target, errorCode) {
  const { root } = context;
  const folder = path.basename(dir);
  const code = errorCode ? "symlink-root-unresolved" : "symlink-root-escape";
  const axis = errorCode ? "safety" : "structure";
  const detail = errorCode || displayPath(target);
  const digest = refusedSymlinkDigest([code, folder, displayPath(root.path), displayPath(dir), detail]);
  const message = errorCode ? `Refused unresolved skill symlink (${detail})`
    : `Refused skill symlink escaping ${displayPath(root.path)}. Target ${detail} was not checked.`;
  return {
    id: `${folder}:${digest}`, name: folder, folder, description: "", body: "", frontmatter: {}, digest,
    fileCount: 0, totalBytes: 0, sources: [sourceLocation(root, dir)],
    findings: [finding(axis, "review", code, message, "SKILL.md", 1, "Place the skill inside the declared root or audit the linked target separately.")],
    axes: { structure: "review", triggers: "pass", safety: errorCode ? "review" : "pass", portability: "pass", claude: "pass", codex: "pass" },
    status: "Needs review", statusKey: "review", _dirReal: "",
  };
}

module.exports = { inspectRoot, hasGuide, discoveryDirectory, discoverInstalls, uncheckedLocations, refusedLink };
