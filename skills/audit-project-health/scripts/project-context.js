"use strict";

// Read declarations as bounded data. Never load a project's config as JavaScript.
const fs = require("node:fs");
const path = require("node:path");

function localPath(value) {
  if (typeof value !== "string" || !value.trim() || /[\\:*?\[\]{}\x00-\x1f]/.test(value)) return "";
  const raw = value.trim().replace(/^\.\//, "");
  if (raw.startsWith("/") || raw.startsWith("~") || raw.split("/").includes("..")) return "";
  const normalized = path.posix.normalize(raw);
  return normalized === "." ? "" : normalized;
}

function projectContext(root, limits, notices = []) {
  const metadataLimit = Math.min(limits.maxFileBytes, limits.maxTotalBytes, 64 * 1024);
  const totalLimit = Math.min(limits.maxTotalBytes, 256 * 1024);
  const readLimit = Math.min(limits.maxFiles, 256);
  let metadataBytes = 0;
  let metadataReads = 0;
  let exhausted = false;
  const checked = new Map();
  function regularPath(rel, directory = false) {
    if (!localPath(rel)) return false;
    let current = root;
    try {
      const parts = rel.split("/");
      for (let i = 0; i < parts.length; i++) {
        // Exact spelling matters on macOS too. Metadata may never follow a link.
        const entry = fs.readdirSync(current, { withFileTypes: true }).find((item) => item.name === parts[i]);
        if (!entry || entry.isSymbolicLink()) return false;
        const last = i === parts.length - 1;
        if (last ? (directory ? !entry.isDirectory() : !entry.isFile()) : !entry.isDirectory()) return false;
        current = path.join(current, parts[i]);
      }
      return true;
    } catch { return false; }
  }
  function text(rel) {
    if (checked.has(rel)) return checked.get(rel);
    if (exhausted) return "";
    let value = "";
    try {
      if (regularPath(rel)) {
        const size = fs.statSync(path.join(root, rel)).size;
        if (size <= metadataLimit) {
          if (metadataBytes + size > totalLimit || metadataReads >= readLimit) {
            exhausted = true;
            notices.push({ code: "metadata-limit", message: `Artifact metadata reached its separate ${totalLimit}-byte / ${readLimit}-file bound; unverified folders remain in the source scan.` });
          } else {
            const buffer = fs.readFileSync(path.join(root, rel));
            metadataBytes += buffer.length;
            metadataReads++;
            value = buffer.toString("utf8");
          }
        }
      }
    } catch { /* Unreadable metadata proves no exclusion. The main scan discloses it. */ }
    checked.set(rel, value);
    return value;
  }
  function json(rel) {
    try { return JSON.parse(text(rel)); } catch { return null; }
  }
  const pkg = json("package.json") || {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const exclusions = new Map();
  function addOutput(value, classification, reason) {
    const rel = localPath(value);
    if (!rel || /^(?:src|app|lib|electron|public|scripts|tests?|config|assets)(?:\/|$)/.test(rel)) return;
    const main = localPath(pkg.main);
    if (main && (main === rel || main.startsWith(rel + "/"))) return;
    exclusions.set(rel, { classification, reason });
  }
  if (deps.electron) addOutput(pkg.build?.directories?.output, "declared-build-output", "declared Electron packaging output, not source");
  if (deps.typescript) {
    for (const [name, command] of Object.entries(pkg.scripts || {})) {
      if (!/^test(?::|$)/.test(name) || typeof command !== "string" || !/(?:^|\s|&&)tsc\s/.test(command)) continue;
      const match = command.match(/\s--outDir(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
      if (match) addOutput(match[1] || match[2] || match[3], "declared-test-output", "declared TypeScript test compilation output");
    }
  }
  let capacitorAppId = "";
  if (deps["@capacitor/core"] && deps["@capacitor/android"]) {
    const config = json("capacitor.config.json");
    capacitorAppId = typeof config?.appId === "string" ? config.appId : "";
    if (!capacitorAppId) {
      for (const rel of ["capacitor.config.ts", "capacitor.config.js"]) {
        const match = text(rel).match(/\bappId\s*:\s*(['"])([A-Za-z0-9_.-]+)\1/);
        if (match) { capacitorAppId = match[2]; break; }
      }
    }
    const generated = json("android/app/src/main/assets/capacitor.config.json");
    if (capacitorAppId && generated?.appId === capacitorAppId) {
      exclusions.set("android/.gradle", { classification: "android-build-cache", reason: "Capacitor Android build cache" });
      exclusions.set("android/app/src/main/assets/public", { classification: "capacitor-generated-web", reason: "generated web copy for the declared Capacitor app; original web source is scanned" });
    }
  }
  function excludedDirectory(rel) {
    if (exclusions.has(rel)) return exclusions.get(rel);
    if (capacitorAppId && /^\.tablet-backup\/[^/]+$/.test(rel)) {
      const summary = json(rel + "/summary.json");
      if (summary?.package?.id === capacitorAppId && typeof summary.takenAt === "string" &&
          Number.isFinite(Date.parse(summary.takenAt)) && summary.copy && typeof summary.copy === "object" &&
          (regularPath(rel + "/apk", true) || regularPath(rel + "/extracted", true))) {
        return { classification: "verified-tablet-backup", reason: "tablet snapshot metadata identifies this app; saved device data is not source" };
      }
    }
    return null;
  }
  return { excludedDirectory };
}

module.exports = { projectContext };
