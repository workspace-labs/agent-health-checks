"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isUtf8 } = require("node:buffer");
const { comparePath, displayPath, inside } = require("./skill-paths");

const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".pdf", ".zip", ".gz", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".mov"]);
const UNREAD_DIRS = new Set(["node_modules", "__pycache__"]);
const DESKTOP_METADATA = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function isBinary(buffer, file) {
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function collectFiles(skillDir, rootReal, limits, discoveryDepth = Infinity) {
  const files = [];
  const notices = [];
  let totalBytes = 0;
  let ordinaryFiles = 0;
  let ordinaryBytes = 0;
  let omitted = 0;
  let limited = false;

  function list(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => comparePath(a.name, b.name));
    } catch (error) {
      notices.push({ code: "unreadable-directory", message: `Could not read ${displayPath(dir)}: ${error.message}` });
      return [];
    }
  }

  // Only list names and types in skipped dependency trees. A link is never a subtree.
  function countExcluded(dir, rel) {
    let count = 0;
    for (const entry of list(dir)) {
      if (entry.isDirectory() && entry.name !== ".git") {
        count += countExcluded(path.join(dir, entry.name), rel + "/" + entry.name);
      } else if (entry.isFile()) count++;
    }
    if (UNREAD_DIRS.has(path.basename(dir))) {
      notices.push({ code: "unread-directory", file: rel, message: `Skipped ${rel} (unread files: ${count})` });
    }
    return count;
  }

  function skipLink(absolute, rel) {
    let real;
    let resolutionCode;
    try { real = fs.realpathSync(absolute); }
    catch (error) { resolutionCode = error.code || "unresolved"; }
    notices.push({
      code: resolutionCode ? "symlink-unresolved" : "symlink-skipped",
      message: resolutionCode
        ? `Skipped unresolved symlink (${resolutionCode}): ${displayPath(absolute)}`
        : !inside(rootReal, real) ? `Refused symlink escaping its root: ${displayPath(absolute)}` : `Skipped symlink: ${displayPath(absolute)}`,
      file: rel,
    });
  }

  function read(rel, priority) {
    if (!priority && (limited || ordinaryFiles >= limits.maxFiles || ordinaryBytes >= limits.maxTotalBytes)) {
      limited = true;
      omitted++;
      return;
    }
    const absolute = path.join(skillDir, rel);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch {
      notices.push({ code: "unreadable-file", message: `Could not read ${rel}`, file: rel });
      return;
    }
    if (stat.isSymbolicLink()) { skipLink(absolute, rel); return; }
    if (!stat.isFile()) return;
    if (stat.size > limits.maxFileBytes) {
      notices.push({ code: "oversized-file", message: `Skipped ${rel}; it exceeds ${limits.maxFileBytes} bytes`, file: rel });
      files.push({ rel, size: stat.size, binary: true, skipped: true, hash: `oversized:${stat.size}` });
      if (!priority) ordinaryFiles++;
      omitted++;
      return;
    }
    if (!priority && ordinaryBytes + stat.size > limits.maxTotalBytes) {
      limited = true;
      omitted++;
      return;
    }
    let buffer;
    try { buffer = fs.readFileSync(absolute); } catch {
      notices.push({ code: "unreadable-file", message: `Could not read ${rel}`, file: rel });
      return;
    }
    if (!priority) {
      ordinaryBytes += buffer.length;
      ordinaryFiles++;
    }
    totalBytes += buffer.length;
    const binary = isBinary(buffer, rel);
    const text = binary ? "" : buffer.toString("utf8");
    const hashInput = !binary && isUtf8(buffer) ? text.replace(/\r\n/g, "\n") : buffer;
    const hash = crypto.createHash("sha256").update(hashInput).digest("hex");
    files.push({ rel, size: buffer.length, binary, skipped: false, hash, text });
  }

  const rootEntries = list(skillDir);
  const agents = rootEntries.find(entry => entry.name === "agents" && entry.isDirectory());
  const hasSkill = rootEntries.some(entry => entry.name === "SKILL.md" && entry.isFile());
  if (hasSkill) read("SKILL.md", true);
  const agentEntries = agents ? list(path.join(skillDir, "agents")) : [];
  const hasOpenai = agentEntries.some(entry => entry.name === "openai.yaml" && entry.isFile());
  if (hasOpenai) read("agents/openai.yaml", true);

  function walk(entries, parent, depth) {
    for (const entry of entries) {
      // A candidate without a guide uses the same discovery boundary on this second walk.
      if (discoveryDepth !== Infinity && entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) continue;
      const rel = parent ? parent + "/" + entry.name : entry.name;
      const absolute = path.join(skillDir, rel);
      if (entry.isSymbolicLink()) { skipLink(absolute, rel); continue; }
      if (entry.isDirectory()) {
        if (entry.name === ".git" || depth >= discoveryDepth) continue;
        if (UNREAD_DIRS.has(entry.name)) {
          if (discoveryDepth === Infinity) countExcluded(absolute, rel);
        } else {
          walk(rel === "agents" ? agentEntries : list(absolute), rel, depth + 1);
        }
      } else if (entry.isFile() && !DESKTOP_METADATA.has(entry.name)) {
        if ((hasSkill && rel === "SKILL.md") || (hasOpenai && rel === "agents/openai.yaml")) continue;
        read(rel, false);
      }
    }
  }

  walk(rootEntries, "", 0);
  if (limited) notices.push({ code: "scan-limit", message: `Stopped at the bounded scan limit (${limits.maxFiles} files / ${limits.maxTotalBytes} bytes)` });
  if (omitted) notices.push({ code: "unread-files", message: `Files not read because of scan limits: ${omitted}` });
  return { files, notices, totalBytes };
}

function digestFiles(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files.slice().sort((a, b) => comparePath(a.rel, b.rel))) hash.update(file.rel).update("\0").update(file.hash).update("\0");
  return hash.digest("hex");
}

// A refused root symlink has no readable content to hash, but it still needs a
// stable identity: this file dedupes by digest, and every consumer of a finding
// (the Skill Clinic's evidence contract) requires a 64-hex digest before it will
// carry the finding forward. Derive one deterministically from the refusal itself
// — the code, the skill name, the declared root, the link, and what the link
// resolved to — so the same refusal always mints the same digest and one card per
// refused link, exactly as the empty-digest path grouped them. Never a content
// hash: nothing inside the escaping target was read, and nothing should be.
function refusedSymlinkDigest(parts) {
  return crypto.createHash("sha256").update(["skill-symlink-refusal", ...parts].join("\0")).digest("hex");
}

module.exports = { collectFiles, digestFiles, refusedSymlinkDigest };
