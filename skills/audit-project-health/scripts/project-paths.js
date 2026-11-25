"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_METADATA_READS = 1024;

// Check exact directory entries even on case-insensitive volumes. A missing name
// is different from a directory we could not list. Share listings for one audit.
function createPathProbe(root, requested = root) {
  const directories = new Map();
  const linkTargets = new Map();
  let remaining = MAX_METADATA_READS;

  function cachedRead(cache, name, read) {
    if (cache.has(name)) return cache.get(name);
    if (remaining === 0) return null;
    remaining--;
    try {
      cache.set(name, read(name));
    } catch (error) {
      cache.set(name, ["ENOENT", "ENOTDIR"].includes(error.code) ? false : null);
    }
    return cache.get(name);
  }

  function list(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    return new Map(entries.map(entry => [entry.name, entry]));
  }

  function locate(candidate, kind, allowOutside) {
    const relative = path.relative(root, candidate);
    let parts = relative.split(path.sep);
    let current = root;
    const outside = parts[0] === ".." || path.isAbsolute(relative);
    if (outside && !allowOutside) return null;
    // For metadata checks, a path beyond the root is unverified. The import
    // resolver permits explicit ../ names but excludes links crossing the boundary.
    const refusedLink = allowOutside ? false : null;
    // An explicit ../ import may address a sibling. Start at the common
    // ancestor so no ambient filesystem tree is walked or opened for content.
    if (path.isAbsolute(relative)) {
      current = path.parse(candidate).root;
      parts = candidate.slice(current.length).split(path.sep);
    }
    let index = 0;
    while (parts[index] === "..") {
      current = path.dirname(current);
      index++;
    }
    let links = 0;
    while (index < parts.length) {
      const name = parts[index++];
      if (!name || name === ".") continue;
      if (name === "..") {
        if (current === root) return refusedLink;
        current = path.dirname(current);
        continue;
      }
      const entries = cachedRead(directories, current, list);
      if (!entries) return entries;
      const entry = entries.get(name);
      if (!entry) return false;
      if (entry.isSymbolicLink()) {
        // Resolve one link at a time. Checking only the final realpath could
        // conceal a route that went outside first and then pointed back in.
        if (outside || ++links > 40) return null;
        let target = cachedRead(linkTargets, path.join(current, name), fs.readlinkSync);
        if (typeof target !== "string") return target;
        if (path.isAbsolute(target)) {
          // auditProject has already canonicalized the requested root. Anchor
          // either spelling there, without following any link beyond it.
          const anchor = [requested, root].find(base =>
            target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep));
          if (!anchor) return refusedLink;
          current = root;
          target = target.slice(anchor.length);
        }
        parts = target.split(path.sep).concat(parts.slice(index));
        index = 0;
        continue;
      }
      current = path.join(current, name);
      if (index === parts.length && kind === "file") return entry.isFile() ? current : false;
      if (!entry.isDirectory()) return false;
    }
    return kind === "directory" ? current : false;
  }

  function isExactProjectFile(candidate, kind = "file", allowOutside = false) {
    const located = locate(candidate, kind, allowOutside);
    return typeof located === "string" ? true : located;
  }
  isExactProjectFile.locate = locate;
  return isExactProjectFile;
}

function resolveNodeEntry(base, probe) {
  const endings = [".js", ".json", ".node"];
  const candidates = [base, ...endings.map(ext => base + ext),
    ...endings.map(ext => path.join(base, "index" + ext))];
  let result = false;
  for (const candidate of candidates) {
    const exists = probe(candidate);
    if (exists) return true;
    if (exists === null) result = null;
  }
  return result;
}

module.exports = { createPathProbe, resolveNodeEntry };
