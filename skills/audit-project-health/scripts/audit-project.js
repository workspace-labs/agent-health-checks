#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { projectContext } = require("./project-context");

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 2400,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 14 * 1024 * 1024,
  maxDurationMs: 1600,
});
const WORKSPACE_ARTIFACT_DIRS = new Map([
  [".backup-install", "workspace-install-backup"],
  [".backup-pipeline", "workspace-task-backup"],
  [".proof", "workspace-review-proof"],
  [".proof-pipeline", "workspace-review-proof"],
  [".trash", "workspace-recoverable-trash"],
]);
// Editor/tool backup FILES the project keeps beside its source (the .gitignore shapes
// "*.bak" and "*.bak-*"). Disclosed like the artifact folders above and never scanned as
// shipped source, so a retained backup cannot raise coverage or source findings of its own.
const WORKSPACE_ARTIFACT_FILE = /\.bak(?:$|-)/;
const SKIP_DIRS = new Set([
  ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".parcel-cache",
  ".venv", "__pycache__", "node_modules", "vendor", "dist", "build", "out", "tmp",
  "coverage", "target", "DerivedData", ".idea", ".vscode", ".pipeline",
  ...WORKSPACE_ARTIFACT_DIRS.keys(),
]);
const SECRET_NAMES = /^(?:\.env(?:\..+)?|.*\.(?:pem|key|p12|pfx)|id_rsa|id_ed25519)$/i;
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".pdf", ".zip",
  ".gz", ".7z", ".tar", ".apk", ".aab", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".mov",
  ".avi", ".dmg", ".app", ".exe", ".dll", ".so", ".dylib", ".wasm", ".sqlite",
]);
const SOURCE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const IMPORT_EXT = ["", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json"];
const REFERENCE_DATA_EXT = new Set([".csv", ".tsv", ".jsonl", ".ndjson"]);

function normalizeLimits(input = {}) {
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const value = Number(input[key]);
    out[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
  return out;
}

function displayPath(root, absolute) {
  const rel = path.relative(root, absolute).split(path.sep).join("/");
  return rel || ".";
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}

function isIntentionalReferenceData(rel) {
  const normalized = String(rel || "").split(path.sep).join("/").toLowerCase();
  const segments = normalized.split("/");
  return REFERENCE_DATA_EXT.has(path.posix.extname(normalized)) &&
    segments.some((segment) => segment === "data" || segment === "reference" || segment === "references");
}

function normalizeDeclaredPath(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = path.posix.normalize(value.trim().replace(/\\/g, "/").replace(/^\.\//, ""));
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return "";
  return normalized;
}

function exactPackagedFiles(pkg) {
  const values = pkg && pkg.build && Array.isArray(pkg.build.files) ? pkg.build.files : [];
  const exact = new Set();
  for (const value of values) {
    if (typeof value !== "string" || /[*?[\]{}!]/.test(value)) continue;
    const normalized = normalizeDeclaredPath(value);
    if (normalized) exact.add(normalized);
  }
  return exact;
}

function buildFilePatternMatches(pattern, rel) {
  if (typeof pattern !== "string") return null;
  const raw = pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw || raw.startsWith("!") || /[\[\]{}()]/.test(raw)) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return null;

  let source = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === "*" && normalized[i + 1] === "*") {
      if (normalized[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
      continue;
    }
    if (char === "*") { source += "[^/]*"; continue; }
    if (char === "?") { source += "[^/]"; continue; }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  try { return new RegExp(source + "$").test(rel); }
  catch { return null; }
}

function excludedByExplicitBuildFiles(rel, pkg) {
  const values = pkg && pkg.build && Array.isArray(pkg.build.files) ? pkg.build.files : [];
  let hasPositivePattern = false;
  for (const value of values) {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("!")) continue;
    hasPositivePattern = true;
    const matches = buildFilePatternMatches(trimmed, rel);
    if (matches === null || matches) return false;
  }
  return hasPositivePattern;
}

function declaredHumanDeliverables(pkg) {
  const config = pkg && pkg.projectDoctor;
  const values = config && Array.isArray(config.intentionalLargeAssets) ? config.intentionalLargeAssets : [];
  const exact = new Set();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (value.kind !== "human-deliverable" || typeof value.path !== "string") continue;
    if (/[*?[\]{}!]/.test(value.path)) continue;
    const normalized = normalizeDeclaredPath(value.path);
    if (normalized && normalized !== ".") exact.add(normalized);
  }
  return exact;
}

function configuredBuildIcon(pkg, fileSet) {
  const build = pkg && pkg.build;
  if (!build || typeof build !== "object") return "";
  const declared = normalizeDeclaredPath((build.mac && build.mac.icon) || build.icon);
  if (!declared) return "";
  const candidates = path.posix.extname(declared) ? [declared] : [declared + ".icns", declared + ".ico", declared + ".png", declared];
  return candidates.find((candidate) => fileSet.has(candidate)) || "";
}

function classifyIntentionalLargeAsset(file, pkg, fileSet) {
  const rel = file.rel;
  // Collected entries are lstat-proven regular files inside the canonical project
  // root. The exact declaration and explicit package exclusion provide the two
  // additional pieces of evidence required for a non-runtime deliverable.
  if (declaredHumanDeliverables(pkg).has(rel) && excludedByExplicitBuildFiles(rel, pkg)) {
    return {
      classification: "declared-human-deliverable",
      reason: "declared as a human-facing deliverable and excluded by the explicit package build files",
    };
  }
  const icon = configuredBuildIcon(pkg, fileSet);
  if (icon && rel === icon) {
    return { classification: "declared-build-icon", reason: `declared by package.json build icon '${icon}'` };
  }

  if (icon) {
    const parsedIcon = path.posix.parse(icon);
    const iconsetPrefix = path.posix.join(parsedIcon.dir, parsedIcon.name + ".iconset") + "/";
    if (rel.startsWith(iconsetPrefix)) {
      return { classification: "icon-generation-source", reason: `belongs to the source iconset for declared build icon '${icon}'` };
    }
  }

  const parsedFile = path.posix.parse(rel);
  if (parsedFile.name.endsWith("-src")) {
    const stem = parsedFile.name.slice(0, -4);
    const packaged = exactPackagedFiles(pkg);
    for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
      const sibling = path.posix.join(parsedFile.dir, stem + ext);
      if (fileSet.has(sibling) && packaged.has(sibling)) {
        return { classification: "packaged-source-master", reason: `has packaged optimized sibling '${sibling}'` };
      }
    }
  }

  if (parsedFile.ext.toLowerCase() === ".zip") {
    const archiveDir = path.posix.dirname(rel);
    const dirName = path.posix.basename(archiveDir);
    if (dirName.endsWith("-zips")) {
      const sourceDir = path.posix.join(path.posix.dirname(archiveDir), dirName.slice(0, -5), parsedFile.name);
      const sourcePrefix = sourceDir + "/";
      if ([...fileSet].some((candidate) => candidate.startsWith(sourcePrefix))) {
        return { classification: "distribution-archive", reason: `has unpacked source sibling '${sourceDir}'` };
      }
    }
  }

  return null;
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function lineAt(text, index) {
  return String(text || "").slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeFinding(reportDigest, data) {
  const finding = {
    code: String(data.code),
    category: String(data.category || "quality"),
    severity: String(data.severity || "low"),
    confidence: String(data.confidence || "recommendation"),
    message: String(data.message || "Review this evidence."),
    file: String(data.file || "."),
    line: Math.max(1, Number(data.line) || 1),
    impact: String(data.impact || "The project may be harder to verify or maintain."),
    verify: String(data.verify || "Inspect the cited evidence before changing code."),
    recommendation: String(data.recommendation || "Confirm the evidence and choose the smallest safe change."),
  };
  finding.id = hash(JSON.stringify({ reportDigest, ...finding })).slice(0, 24);
  return finding;
}

function collectProject(root, limits) {
  const started = Date.now();
  const files = [];
  const notices = [];
  const context = projectContext(root, limits, notices);
  let totalBytes = 0;
  let limited = false;

  function stop(reason) {
    if (!limited) notices.push({ code: "scan-limit", message: reason });
    limited = true;
  }

  function walk(dir) {
    if (limited) return;
    if (Date.now() - started > limits.maxDurationMs) return stop(`Stopped after the ${limits.maxDurationMs}ms time bound.`);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (error) { notices.push({ code: "unreadable-directory", message: `Could not read ${displayPath(root, dir)}: ${error.message}` }); return; }

    for (const entry of entries) {
      if (limited) break;
      if (files.length >= limits.maxFiles) return stop(`Stopped at the ${limits.maxFiles}-file bound.`);
      if (Date.now() - started > limits.maxDurationMs) return stop(`Stopped after the ${limits.maxDurationMs}ms time bound.`);
      const absolute = path.join(dir, entry.name);
      let stat;
      try { stat = fs.lstatSync(absolute); } catch { continue; }
      if (stat.isSymbolicLink()) {
        let real = "";
        let resolutionCode = "";
        try { real = fs.realpathSync(absolute); }
        catch (error) { resolutionCode = error && error.code ? error.code : "unresolved"; }
        notices.push({
          code: resolutionCode ? "symlink-unresolved" : real && !inside(root, real) ? "symlink-escape" : "symlink-skipped",
          ...(real && inside(root, real) ? { actionable: false, classification: "in-project-symlink" } : {}),
          message: resolutionCode
            ? `Skipped unresolved symlink (${resolutionCode}): ${displayPath(root, absolute)}`
            : real && !inside(root, real) ? `Refused symlink escaping the project: ${displayPath(root, absolute)}` : `Skipped symlink: ${displayPath(root, absolute)}`,
        });
        continue;
      }
      if (stat.isDirectory()) {
        const excluded = context.excludedDirectory(displayPath(root, absolute));
        if (excluded) {
          notices.push({ code: "project-artifact-excluded", message: `Excluded ${displayPath(root, absolute)}: ${excluded.reason}.`, actionable: false, classification: excluded.classification });
          continue;
        }
        const artifactClassification = WORKSPACE_ARTIFACT_DIRS.get(entry.name);
        if (artifactClassification) {
          const rel = displayPath(root, absolute);
          notices.push({
            code: "workspace-artifact-excluded",
            message: `Excluded Workspace artifact folder ${rel}; its contents were not scanned as shipped project source.`,
            actionable: false,
            classification: artifactClassification,
          });
          continue;
        }
        if (!SKIP_DIRS.has(entry.name)) walk(absolute);
        continue;
      }
      if (!stat.isFile()) continue;
      const rel = displayPath(root, absolute);
      if (SECRET_NAMES.test(entry.name)) {
        files.push({ rel, absolute, size: stat.size, secret: true, binary: true, skipped: true, text: "", digest: `secret:${stat.size}` });
        continue;
      }
      if (WORKSPACE_ARTIFACT_FILE.test(entry.name)) {
        notices.push({
          code: "workspace-artifact-excluded",
          message: `Excluded Workspace artifact file ${rel}; it was not scanned as shipped project source.`,
          actionable: false,
          classification: "workspace-editor-backup",
        });
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXT.has(ext)) {
        files.push({ rel, absolute, size: stat.size, binary: true, skipped: false, text: "", digest: `binary:${stat.size}` });
        continue;
      }
      if (stat.size > limits.maxFileBytes) {
        files.push({ rel, absolute, size: stat.size, binary: false, skipped: true, text: "", digest: `oversized:${stat.size}` });
        const intentionalReferenceData = isIntentionalReferenceData(rel);
        notices.push({
          code: "oversized-text",
          message: `Skipped ${rel}; it exceeds ${limits.maxFileBytes} bytes.`,
          actionable: !intentionalReferenceData,
          classification: intentionalReferenceData ? "reference-data" : "unclassified-text",
        });
        continue;
      }
      if (totalBytes + stat.size > limits.maxTotalBytes) return stop(`Stopped at the ${limits.maxTotalBytes}-byte text bound.`);
      let buffer;
      try { buffer = fs.readFileSync(absolute); } catch { notices.push({ code: "unreadable-file", message: `Could not read ${rel}.` }); continue; }
      totalBytes += buffer.length;
      const binary = buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
      const text = binary ? "" : buffer.toString("utf8");
      files.push({ rel, absolute, size: buffer.length, binary, skipped: false, text, digest: hash(buffer) });
    }
  }

  walk(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, notices, limited, totalBytes, durationMs: Date.now() - started };
}

function parsePackage(file) {
  if (!file || !file.text) return { value: null, error: null };
  try { return { value: JSON.parse(file.text), error: null }; }
  catch (error) { return { value: null, error }; }
}

function detectStack(files, pkg) {
  const stack = new Set();
  const names = new Set(files.map((file) => file.rel.toLowerCase()));
  const deps = { ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}) };
  if (pkg || [...names].some((name) => SOURCE_EXT.has(path.extname(name)))) stack.add("JavaScript");
  if (deps.typescript || names.has("tsconfig.json")) stack.add("TypeScript");
  if (deps.react) stack.add("React");
  if (deps.next || [...names].some((name) => /^next\.config\./.test(name))) stack.add("Next.js");
  if (deps.vite || [...names].some((name) => /^vite\.config\./.test(name))) stack.add("Vite");
  if (Object.keys(deps).some((name) => name.startsWith("@tanstack/"))) stack.add("TanStack");
  if (deps.electron || (pkg && typeof pkg.main === "string" && /electron/i.test(JSON.stringify(pkg.scripts || {})))) stack.add("Electron");
  if (deps["next-pwa"] || deps.workbox || deps["workbox-webpack-plugin"] || names.has("manifest.webmanifest") || names.has("public/manifest.json")) stack.add("PWA");
  if (names.has("pyproject.toml") || names.has("requirements.txt")) stack.add("Python");
  if (!stack.size) stack.add("Generic");
  return [...stack];
}

function isExactProjectFile(root, candidate) {
  if (!inside(root, candidate)) return false;
  try {
    const realRoot = fs.realpathSync(root);
    const parts = path.relative(root, candidate).split(path.sep);
    let current = realRoot;
    for (let i = 0; i < parts.length; i++) {
      const entry = fs.readdirSync(current, { withFileTypes: true }).find((item) => item.name === parts[i]);
      if (!entry) return false;
      if (i === parts.length - 1) return entry.isFile();
      current = fs.realpathSync(path.join(current, entry.name));
      if (!inside(realRoot, current) || !fs.statSync(current).isDirectory()) return false;
    }
  } catch { return false; }
  // Match every path segment exactly, even on case-insensitive filesystems, and
  // never follow a parent link beyond the root or accept a linked target file.
  return false;
}

function resolveRelativeImport(file, spec, fileSet, root) {
  if (!spec.startsWith(".")) return true;
  // Bundlers such as Vite attach resource queries (`?url`, `?raw`) and fragments
  // to a real on-disk path. Resolve the filesystem portion only.
  const diskSpec = spec.split(/[?#]/, 1)[0];
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file.rel), diskSpec));
  const typescript = /\.(?:tsx?|mts|cts)$/.test(file.rel);
  const extension = path.posix.extname(base);
  const substitutions = typescript ? {
    ".js": [".ts", ".tsx", ".d.ts"], ".jsx": [".ts", ".tsx", ".d.ts"],
    ".mjs": [".mts", ".d.mts"], ".cjs": [".cts", ".d.cts"],
  }[extension] || [] : [];
  const extensions = typescript ? IMPORT_EXT : IMPORT_EXT.filter((ext) => ext !== ".ts" && ext !== ".tsx");
  const candidates = [
    ...substitutions.map((ext) => base.slice(0, -extension.length) + ext),
    ...extensions.map((ext) => base + ext),
    ...extensions.slice(1).map((ext) => path.posix.join(base, "index" + ext)),
  ];
  for (const rel of candidates) {
    if (fileSet.has(rel)) return true;
    // A bounded content scan can stop before collecting a valid target that is
    // later in lexical traversal order. Check only exact file metadata inside the
    // explicit project root before calling the import Confirmed broken; never read
    // or execute the target through this fallback.
    if (root && isExactProjectFile(root, path.resolve(root, ...rel.split("/")))) return true;
  }
  return false;
}

function isTestPath(rel) {
  return /(?:^|\/)(?:tests?|__tests__|fixtures?)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(String(rel || ""));
}

// Trees a project keeps beside its source that are not the shipped product: scratch
// mockups and their drivers ("demos/..."), and a skill's starter code ("skills-library/
// <skill>/templates/..."). Session leftovers ("tmp/") never reach here - SKIP_DIRS drops
// them at traversal. Narrow on purpose: the segment must be exactly "demos", so a root
// "demo-debug.js" is still ordinary source, and the template rule is anchored to a skill
// package, so an application's own "src/templates/app.js" still counts.
function isNonProductionSource(rel) {
  const value = String(rel || "");
  return /(?:^|\/)demos(?:\/|$)/.test(value)
    || /^skills-library\/[^/]+\/templates(?:\/|$)/.test(value);
}

function isExplicitNodeCli(text) {
  return /^#![^\r\n]*\bnode(?:\s|$)/.test(String(text || ""));
}

function executableDebuggerIndexes(text) {
  const source = String(text || "");
  const indexes = [];
  const regexPrefixWords = new Set([
    "await", "case", "delete", "do", "else", "in", "instanceof", "new",
    "of", "return", "throw", "typeof", "void", "yield",
  ]);
  let canStartRegex = true;

  for (let i = 0; i < source.length;) {
    const char = source[i];
    const next = source[i + 1];

    if (/\s/.test(char)) { i++; continue; }

    if (char === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(source.length, i + 2);
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      canStartRegex = false;
      continue;
    }
    if (char === "/" && canStartRegex) {
      let inClass = false;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "/" && !inClass) { i++; break; }
        i++;
      }
      while (/[a-z]/i.test(source[i] || "")) i++;
      canStartRegex = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = i;
      i++;
      while (/[A-Za-z0-9_$]/.test(source[i] || "")) i++;
      const word = source.slice(start, i);
      if (word === "debugger") {
        let end = i;
        while (source[end] === " " || source[end] === "\t" || source[end] === "\r") end++;
        if (source[end] === ";" || source[end] === "\n" || end === source.length) indexes.push(start);
      }
      canStartRegex = regexPrefixWords.has(word);
      continue;
    }
    if (/[0-9]/.test(char)) {
      i++;
      while (/[A-Za-z0-9_.]/.test(source[i] || "")) i++;
      canStartRegex = false;
      continue;
    }

    canStartRegex = /[({[,:;=!?&|+\-*%^~<>]/.test(char);
    i++;
  }
  return indexes;
}

function debugResidueIndexes(text, toolOutput = false) {
  const source = String(text || "");
  const indexes = executableDebuggerIndexes(source);
  if (!toolOutput && !isExplicitNodeCli(source)) {
    for (const match of source.matchAll(/\bconsole\.log\b/g)) indexes.push(match.index);
  }
  return indexes.sort((a, b) => a - b);
}

function auditProject(options = {}) {
  const requested = path.resolve(String(options.projectPath || options.path || process.cwd()));
  const limits = normalizeLimits(options.limits);
  const projectId = String(options.projectId || path.basename(requested));
  const projectName = String(options.projectName || projectId);
  let root;
  try {
    const stat = fs.statSync(requested);
    if (!stat.isDirectory()) throw new Error("Target is not a directory");
    root = fs.realpathSync(requested);
  } catch (error) {
    const reportDigest = hash(`unavailable:${requested}:${error.message}`);
    const finding = makeFinding(reportDigest, {
      code: "project-unavailable", category: "structure", severity: "high", confidence: "confirmed",
      message: `Project root is unavailable: ${error.message}`, file: ".", line: 1,
      impact: "The Doctor cannot inspect or verify this project.",
      verify: "Confirm the catalog code_location and folder permissions.",
      recommendation: "Correct the project path or restore access, then scan again.",
    });
    return {
      schemaVersion: 1, readOnly: true, projectId, projectName, root: requested,
      digest: reportDigest, status: "Unavailable", statusKey: "unavailable", stack: ["Unknown"],
      summary: { findings: 1, confirmed: 1, likely: 0, recommendation: 0, high: 1 },
      findings: [finding], notices: [], limits, fileCount: 0, totalBytes: 0, durationMs: 0,
      disclaimer: "Static evidence only. No project code was executed or changed.",
    };
  }

  const collected = collectProject(root, limits);
  const fileMap = new Map(collected.files.map((file) => [file.rel, file]));
  const fileSet = new Set(fileMap.keys());
  const packageFile = fileMap.get("package.json");
  const parsed = parsePackage(packageFile);
  const digestInput = collected.files.map((file) => `${file.rel}\0${file.digest}`).join("\0");
  const reportDigest = hash(digestInput || `empty:${root}`);
  const rawFindings = [];
  const add = (data) => rawFindings.push(data);

  if (parsed.error) add({
    code: "malformed-package-json", category: "structure", severity: "high", confidence: "confirmed",
    message: `package.json is not valid JSON: ${parsed.error.message}`, file: "package.json", line: 1,
    impact: "Package tooling cannot reliably read the project metadata.",
    verify: "Parse package.json with a JSON parser.", recommendation: "Correct only the malformed JSON, then re-run the scan and package checks.",
  });

  const pkg = parsed.value;
  const stack = detectStack(collected.files, pkg);
  if (!fileMap.has("README.md") && !fileMap.has("readme.md")) add({
    code: "missing-readme", category: "maintainability", severity: "low", confidence: "recommendation",
    message: "No root README.md was found.", file: ".", line: 1,
    impact: "Future contributors and agents must reverse-engineer how to run and verify the project.",
    verify: "Check whether operating instructions live in another intentional location.",
    recommendation: "Add a short README covering purpose, setup, run, test, and current behavior.",
  });

  if (pkg) {
    const main = typeof pkg.main === "string" ? pkg.main.replace(/^\.\//, "") : "";
    if (main && !fileSet.has(main)) add({
      code: "missing-package-entry", category: "bug", severity: "high", confidence: "confirmed",
      message: `package.json declares a missing main entry: ${main}`, file: "package.json", line: lineAt(packageFile.text, packageFile.text.indexOf('"main"')),
      impact: "Node or Electron cannot launch through the declared package entry.",
      verify: `Confirm that ${main} is absent with the same filename and case.`,
      recommendation: "Restore the entry file or correct the package main field.",
    });
    const scripts = pkg.scripts || {};
    const testScript = typeof scripts.test === "string" ? scripts.test.trim() : "";
    if (!testScript || /no test specified|exit 1/i.test(testScript)) add({
      code: "missing-test-script", category: "tests", severity: "medium", confidence: "recommendation",
      message: "The package has no usable test script.", file: "package.json", line: lineAt(packageFile.text, Math.max(0, packageFile.text.indexOf('"scripts"'))),
      impact: "Regressions are harder to detect consistently across agents and machines.",
      verify: "Check for a test runner invoked outside package.json before adding a script.",
      recommendation: "Expose the smallest reliable automated test command through the package scripts.",
    });
    const dependencyCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
    const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
    if (dependencyCount && !lockfiles.some((name) => fileSet.has(name))) add({
      code: "missing-lockfile", category: "maintainability", severity: "medium", confidence: "likely",
      message: "Dependencies are declared but no recognized lockfile was found.", file: "package.json", line: 1,
      impact: "Installs may resolve different dependency versions across machines or agents.",
      verify: "Confirm that the project intentionally excludes its package-manager lockfile.",
      recommendation: "Choose the project package manager and commit its lockfile when appropriate.",
    });
  }

  const sourceFiles = collected.files.filter((file) => !file.binary && !file.skipped && SOURCE_EXT.has(path.extname(file.rel).toLowerCase()));
  // Test and fixture bodies commonly embed deliberately broken/risky code as string
  // samples. Keep them in the project digest, but do not treat those samples as live
  // production evidence for import, runtime, security, or residue heuristics.
  // Scratch demo trees and skill templates are held to the same rule for the same reason:
  // they are read as samples, never loaded by the shipped app, so their risky-looking code
  // is not live production evidence either.
  const runtimeSourceFiles = sourceFiles.filter((file) => !isTestPath(file.rel) && !isNonProductionSource(file.rel));
  let brokenImports = 0;
  for (const file of runtimeSourceFiles) {
    const importPattern = /(?:\bfrom\s*|\brequire\s*\(|\bimport\s*\()\s*["'](\.[^"']+)["']/g;
    let match;
    while ((match = importPattern.exec(file.text)) && brokenImports < 24) {
      if (resolveRelativeImport(file, match[1], fileSet, root)) continue;
      brokenImports++;
      add({
        code: "broken-relative-import", category: "bug", severity: "high", confidence: "confirmed",
        message: `Relative import does not resolve: ${match[1]}`, file: file.rel, line: lineAt(file.text, match.index),
        impact: "The importing module may fail to build or load.",
        verify: "Resolve the import with the project compiler and confirm filename case on disk.",
        recommendation: "Correct the import path or restore the missing module without changing unrelated imports.",
      });
    }
  }

  if (stack.includes("Electron")) {
    const electronFiles = runtimeSourceFiles.filter((file) => /BrowserWindow|webPreferences|electron/i.test(file.text));
    const risky = [
      ["electron-node-integration", /nodeIntegration\s*:\s*true/g, "nodeIntegration is enabled in an Electron renderer.", "Untrusted renderer content may gain direct Node.js access.", "Disable nodeIntegration and expose a narrow context-isolated preload API."],
      ["electron-context-isolation", /contextIsolation\s*:\s*false/g, "Electron context isolation is disabled.", "Page scripts may interfere with privileged preload state.", "Enable contextIsolation and keep the bridge narrowly scoped."],
      ["electron-web-security", /webSecurity\s*:\s*false/g, "Electron web security is disabled.", "The renderer loses important browser-origin protections.", "Restore webSecurity unless a narrowly documented exception is essential."],
      ["electron-sandbox-disabled", /sandbox\s*:\s*false/g, "The Electron renderer sandbox is explicitly disabled.", "A renderer compromise may have a larger impact.", "Enable the sandbox when compatible, or document and verify the required exception."],
    ];
    for (const file of electronFiles) for (const [code, pattern, message, impact, recommendation] of risky) {
      const match = pattern.exec(file.text); pattern.lastIndex = 0;
      if (match) add({ code, category: "security", severity: "high", confidence: "likely", message, file: file.rel, line: lineAt(file.text, match.index), impact, verify: "Inspect the effective BrowserWindow webPreferences at runtime.", recommendation });
    }
  }

  if (stack.includes("PWA")) {
    const hasManifest = [...fileSet].some((name) => /(?:^|\/)(?:manifest\.json|manifest\.webmanifest)$/i.test(name));
    const hasWorker = [...fileSet].some((name) => /(?:service-worker|sw)\.(?:js|ts)$/i.test(name));
    if (!hasManifest) add({ code: "pwa-missing-manifest", category: "structure", severity: "medium", confidence: "likely", message: "PWA tooling is present but no web app manifest was found.", file: "package.json", line: 1, impact: "Install metadata and standalone behavior may be incomplete.", verify: "Inspect framework-generated metadata and the built output before treating this as a defect.", recommendation: "Add or explicitly generate a valid web app manifest." });
    if (!hasWorker) add({ code: "pwa-missing-worker", category: "performance", severity: "medium", confidence: "recommendation", message: "PWA tooling is present but no source service worker was found.", file: "package.json", line: 1, impact: "Offline and caching behavior may depend entirely on generated framework output.", verify: "Inspect the production build and registration path.", recommendation: "Document the generated worker or add an intentional offline strategy." });
  }

  const secretFiles = collected.files.filter((file) => file.secret);
  if (secretFiles.length) add({
    code: "secret-files-present", category: "security", severity: "high", confidence: "likely",
    message: `${secretFiles.length} secret-like file${secretFiles.length === 1 ? " is" : "s are"} present in the project tree; contents were not read.`, file: secretFiles[0].rel, line: 1,
    impact: "Secrets may be copied, committed, packaged, or exposed accidentally.",
    verify: "Confirm ignore rules and version-control status without printing secret values.",
    recommendation: "Keep secrets outside distributable source and document safe local configuration.",
  });

  const largeFiles = collected.files.filter((file) => file.size > 1024 * 1024 && !file.secret).sort((a, b) => b.size - a.size || a.rel.localeCompare(b.rel));
  const oversized = [];
  const intentionalLarge = [];
  const nonProductionLarge = [];
  for (const file of largeFiles) {
    // Not runtime weight, for the same reason the tree is not runtime source. Disclosed as
    // one grouped non-actionable notice rather than a performance finding about the product.
    if (isNonProductionSource(file.rel)) { nonProductionLarge.push(file); continue; }
    const classification = classifyIntentionalLargeAsset(file, pkg, fileSet);
    if (classification) intentionalLarge.push({ file, ...classification });
    else oversized.push(file);
  }
  if (nonProductionLarge.length) collected.notices.push({
    code: "non-production-large-asset",
    message: `Excluded ${nonProductionLarge.length} file${nonProductionLarge.length === 1 ? "" : "s"} over 1 MiB under non-production trees (scratch demos and skill templates); largest is ${nonProductionLarge[0].rel} (${formatMiB(nonProductionLarge[0].size)}).`,
    actionable: false,
    classification: "non-production-tree",
  });
  for (const item of intentionalLarge.sort((a, b) => a.file.rel.localeCompare(b.file.rel))) {
    collected.notices.push({
      code: "intentional-large-asset",
      message: `Retained ${item.file.rel} (${formatMiB(item.file.size)}): ${item.reason}.`,
      actionable: false,
      classification: item.classification,
    });
  }
  if (oversized.length) add({
    code: "large-project-files", category: "performance", severity: "medium", confidence: "likely",
    message: `${oversized.length} project file${oversized.length === 1 ? " exceeds" : "s exceed"} 1 MiB; largest is ${oversized[0].rel}.`, file: oversized[0].rel, line: 1,
    impact: "Large source assets can slow packaging, loading, transfers, or repository operations.",
    verify: "Measure whether the cited file enters the shipped bundle or runtime path.",
    recommendation: "Compress, split, lazy-load, or exclude the file based on measured use.",
  });

  let todoCount = 0;
  let todoEvidence = null;
  let debugCount = 0;
  let debugEvidence = null;
  let emptyCatchCount = 0;
  let emptyCatchEvidence = null;
  let dynamicExecCount = 0;
  let dynamicExecEvidence = null;
  let toolingLogs = 0;
  const electronDependency = pkg?.dependencies?.electron || pkg?.devDependencies?.electron;
  for (const file of runtimeSourceFiles) {
    const todo = file.text.match(/\b(?:TODO|FIXME)\b/g);
    if (todo && todo.length) { todoCount += todo.length; if (!todoEvidence) todoEvidence = { file: file.rel, line: lineAt(file.text, file.text.search(/\b(?:TODO|FIXME)\b/)) }; }
    // Tool scripts print their results. Only excuse logs when the actual Electron
    // package allowlist proves the script is not shipped; all other checks remain.
    const toolOutput = Boolean(electronDependency && file.rel.startsWith("scripts/") &&
      normalizeDeclaredPath(pkg.main) !== file.rel && excludedByExplicitBuildFiles(file.rel, pkg));
    if (toolOutput) toolingLogs += (file.text.match(/\bconsole\.log\b/g) || []).length;
    const debug = debugResidueIndexes(file.text, toolOutput);
    if (debug.length) { debugCount += debug.length; if (!debugEvidence) debugEvidence = { file: file.rel, line: lineAt(file.text, debug[0]) }; }
    const emptyCatch = file.text.match(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g);
    if (emptyCatch && emptyCatch.length) { emptyCatchCount += emptyCatch.length; if (!emptyCatchEvidence) emptyCatchEvidence = { file: file.rel, line: lineAt(file.text, file.text.search(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/)) }; }
    const dynamic = file.text.match(/\b(?:eval\s*\(|new\s+Function\s*\()/g);
    if (dynamic && dynamic.length) { dynamicExecCount += dynamic.length; if (!dynamicExecEvidence) dynamicExecEvidence = { file: file.rel, line: lineAt(file.text, file.text.search(/\b(?:eval\s*\(|new\s+Function\s*\()/)) }; }
  }
  if (toolingLogs) collected.notices.push({
    code: "tooling-console-output", actionable: false, classification: "unpackaged-tool-output",
    message: `${toolingLogs} console.log occurrences belong to scripts excluded by the explicit Electron package files; executable debugger and other source checks still apply.`,
  });
  if (todoCount >= 8) add({ code: "todo-concentration", category: "maintainability", severity: "low", confidence: "recommendation", message: `${todoCount} TODO/FIXME markers remain in source files.`, ...todoEvidence, impact: "Deferred work may hide known gaps or make readiness unclear.", verify: "Review the markers and distinguish active work from stale notes.", recommendation: "Convert meaningful items into tracked work and remove obsolete markers." });
  if (debugCount >= 4) add({ code: "debug-residue", category: "performance", severity: "low", confidence: "recommendation", message: `${debugCount} debugger or console.log statements remain in source files.`, ...debugEvidence, impact: "Verbose production logging can expose data or add noise and small runtime cost.", verify: "Check the production build and intended logging policy.", recommendation: "Remove temporary statements or route intentional logs through the project logger." });
  if (emptyCatchCount) add({ code: "empty-catch", category: "bug", severity: "medium", confidence: "likely", message: `${emptyCatchCount} empty catch block${emptyCatchCount === 1 ? " suppresses" : "s suppress"} errors without evidence.`, ...emptyCatchEvidence, impact: "Failures may become silent and difficult to diagnose.", verify: "Exercise the surrounding failure path and inspect expected recovery behavior.", recommendation: "Handle, report, or deliberately document the swallowed error." });
  if (dynamicExecCount) add({ code: "dynamic-code-execution", category: "security", severity: "high", confidence: "likely", message: `${dynamicExecCount} dynamic code execution primitive${dynamicExecCount === 1 ? " was" : "s were"} found.`, ...dynamicExecEvidence, impact: "Untrusted input may become executable code if the call path is not tightly controlled.", verify: "Trace every input reaching the cited primitive.", recommendation: "Replace dynamic evaluation with explicit parsing or a constrained dispatch table." });

  for (const notice of collected.notices) {
    if (notice.actionable === false) continue;
    add({
      code: notice.code, category: "coverage", severity: notice.code === "symlink-escape" ? "medium" : "low", confidence: notice.code === "symlink-escape" ? "likely" : "recommendation",
      message: notice.message, file: ".", line: 1,
      impact: "The static report does not cover every item in the project tree.",
      verify: "Review the skipped or bounded area separately if it is relevant.",
      recommendation: "Keep scan exclusions intentional and use an approved focused check when stronger coverage is needed.",
    });
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const confidenceRank = { confirmed: 0, likely: 1, recommendation: 2 };
  const findings = rawFindings.map((item) => makeFinding(reportDigest, item)).sort((a, b) =>
    (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
    (confidenceRank[a.confidence] ?? 9) - (confidenceRank[b.confidence] ?? 9) ||
    a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code)
  );
  const count = (key, value) => findings.filter((finding) => finding[key] === value).length;
  const confirmed = count("confidence", "confirmed");
  const likely = count("confidence", "likely");
  const recommendation = count("confidence", "recommendation");
  const high = findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length;
  const status = confirmed || high ? "Needs attention" : findings.length ? "Watch" : "Healthy";
  const statusKey = status === "Needs attention" ? "attention" : status.toLowerCase();
  return {
    schemaVersion: 1, readOnly: true, projectId, projectName, root, digest: reportDigest,
    status, statusKey, stack,
    summary: { findings: findings.length, confirmed, likely, recommendation, high },
    findings, notices: collected.notices, limits, fileCount: collected.files.length,
    totalBytes: collected.totalBytes, durationMs: collected.durationMs,
    disclaimer: "Static evidence only. No project code was executed, fetched, installed, or changed.",
  };
}

function resolveFinding(report, request = {}) {
  if (!report || report.digest !== String(request.digest || "")) return null;
  const finding = (report.findings || []).find((item) => item.id === String(request.findingId || ""));
  return finding ? { report, finding } : null;
}

function parseArgs(argv) {
  const out = { json: false, projectPath: "", projectId: "", projectName: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--path") out.projectPath = argv[++i] || "";
    else if (argv[i] === "--id") out.projectId = argv[++i] || "";
    else if (argv[i] === "--name") out.projectName = argv[++i] || "";
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
  }
  return out;
}

function humanReport(report) {
  const lines = [
    `Universal Project Doctor — ${report.projectName}`,
    `${report.status} · ${report.stack.join(" / ")} · ${report.fileCount} files · ${report.durationMs}ms`,
    `Confirmed ${report.summary.confirmed} · Likely ${report.summary.likely} · Recommendations ${report.summary.recommendation}`,
    "",
  ];
  for (const finding of report.findings) {
    lines.push(`[${finding.severity.toUpperCase()} · ${finding.confidence}] ${finding.message}`);
    lines.push(`  ${finding.file}:${finding.line} · ${finding.category} · ${finding.code}`);
    lines.push(`  Impact: ${finding.impact}`);
    lines.push(`  Verify: ${finding.verify}`);
    lines.push(`  Recommendation: ${finding.recommendation}`, "");
  }
  if (!report.findings.length) lines.push("No static findings in the bounded scan.", "");
  if (report.notices.length) {
    lines.push(`Scan boundaries (${report.notices.length})`);
    for (const notice of report.notices) lines.push(`  [${notice.classification || notice.code}] ${notice.message}`);
    lines.push("");
  }
  lines.push(report.disclaimer);
  return lines.join("\n");
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("Usage: node scripts/audit-project.js --path /absolute/project [--json] [--id id] [--name name]\n");
    process.exit(0);
  }
  if (!args.projectPath) {
    process.stderr.write("--path is required; refuse broad implicit scans.\n");
    process.exit(2);
  }
  const report = auditProject(args);
  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : humanReport(report) + "\n");
}

module.exports = { DEFAULT_LIMITS, auditProject, collectProject, humanReport, isIntentionalReferenceData, resolveFinding };
