"use strict";

const path = require("path");
const os = require("os");

function comparePath(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function expandHome(value) {
  const s = String(value || "");
  return s === "~" ? os.homedir() : s.startsWith("~/") ? path.join(os.homedir(), s.slice(2)) : path.resolve(s);
}

function displayPath(value) {
  const p = String(value || "");
  return p === os.homedir() ? "~" : p.startsWith(os.homedir() + path.sep) ? "~" + p.slice(os.homedir().length) : p;
}

function defaultRoots() {
  return [
    { id: "claude", label: "Claude", path: path.join(os.homedir(), ".claude", "skills") },
    { id: "codex", label: "Codex", path: path.join(os.homedir(), ".codex", "skills") },
    { id: "agents", label: "Agent Skills", path: path.join(os.homedir(), ".agents", "skills") },
  ];
}

function normalizeRoots(roots) {
  return (roots && roots.length ? roots : defaultRoots()).map((root, index) => {
    if (typeof root === "string") return { id: `root-${index + 1}`, label: `Root ${index + 1}`, path: expandHome(root) };
    return {
      id: String(root.id || `root-${index + 1}`),
      label: String(root.label || root.id || `Root ${index + 1}`),
      path: expandHome(root.path),
    };
  });
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}

function sourceLocation(root, dir) {
  return { id: root.id, label: root.label, root: displayPath(root.path), path: displayPath(dir), skillMd: displayPath(path.join(dir, "SKILL.md")) };
}

module.exports = { comparePath, displayPath, defaultRoots, normalizeRoots, inside, sourceLocation };
