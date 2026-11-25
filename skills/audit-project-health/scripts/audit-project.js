#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { projectContext, gitInfoExclude, addLiteralIgnoreFolders } = require("./project-context");
const { electronRules, executableEvidence, isExplicitNodeCli } = require("./source-evidence");
const { createPathProbe, resolveNodeEntry } = require("./project-paths");
const { relativeImportLiterals } = require("./import-context");
const { hasUtf16Mark, packageReadProblem, parsePackage } = require("./package-text");

const CHECKER_VERSION = "0.5.0";
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
  ".venv", "__pycache__", "node_modules", "DerivedData", ".idea", ".vscode", ".pipeline",
  ...WORKSPACE_ARTIFACT_DIRS.keys(),
]);
const ROOT_OUTPUT_DIRS = new Set(["vendor", "dist", "build", "out", "tmp", "coverage", "target"]);
const SECRET_NAMES = /^(?:\.env(?:\..+)?|.*\.(?:pem|key|p12|pfx|keystore|jks)|id_(?:rsa|ed25519|ecdsa|dsa)|\.(?:npmrc|netrc|pypirc|git-credentials)|credentials\.json)$/i;
const TEMPLATE_SUFFIX = /\.(?:example|sample|template|dist)$/i;
const DESKTOP_METADATA = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".pdf", ".zip",
  ".gz", ".7z", ".tar", ".apk", ".aab", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".mov",
  ".avi", ".dmg", ".app", ".exe", ".dll", ".so", ".dylib", ".wasm", ".sqlite",
]);
const SOURCE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
// Recognize other source languages by filename without claiming to analyze them.
const OTHER_LANGUAGES = new Map(Object.entries({
  ".py": "Python", ".pyi": "Python", ".go": "Go", ".rs": "Rust", ".swift": "Swift", ".php": "PHP",
  ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".cs": "C#", ".c": "C", ".h": "C/C++",
  ".cc": "C++", ".cpp": "C++", ".cxx": "C++", ".hpp": "C++", ".m": "Objective-C/MATLAB", ".mm": "Objective-C++",
  ".dart": "Dart", ".rb": "Ruby", ".pl": "Perl", ".pm": "Perl", ".lua": "Lua", ".r": "R",
  ".scala": "Scala", ".groovy": "Groovy", ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang",
  ".hs": "Haskell", ".clj": "Clojure", ".fs": "F#", ".fsx": "F#", ".jl": "Julia", ".zig": "Zig",
  ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".fish": "Shell", ".ps1": "PowerShell",
  ".html": "HTML", ".htm": "HTML", ".css": "CSS", ".scss": "Sass", ".sass": "Sass", ".less": "Less",
  ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro", ".sql": "SQL",
}));
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

function compareNames(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isProtectedFile(name, rel) {
  return !TEMPLATE_SUFFIX.test(name) && (SECRET_NAMES.test(name) || /(?:^|\/)\.aws\/credentials$/i.test(rel));
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

function coverageNotice(count, languages) {
  return {
    code: "code-coverage", actionable: false,
    message: `Code rules examined ${count} JavaScript/TypeScript file${count === 1 ? "" : "s"}. Other languages seen but not examined: ${languages || "none"}.`,
  };
}

function collectProject(root, limits, rootEntries, started = Date.now()) {
  const files = [];
  const notices = [];
  let context;
  const incompleteDirectories = new Set();
  const workerPaths = [];
  const nestedPackages = [];
  const otherLanguages = new Set();
  const excludedFolders = new Set();
  const rootDirectoryNames = new Set();
  const ignoreNames = new Set();
  let packageReadError = "";
  let totalBytes = 0;
  let limited = false;

  function stop(reason) {
    if (!limited) notices.push({ code: "scan-limit", message: reason });
    limited = true;
  }

  function timeExpired() {
    if (Date.now() - started < limits.maxDurationMs) return false;
    stop(`Stopped after the ${limits.maxDurationMs}ms time bound.`);
    return true;
  }

  function artifactContext() {
    if (!context) {
      const canRead = rel => !timeExpired() && !(rel.includes("/") && ignoreNames.has(rel.split("/")[0]));
      context = projectContext(root, limits, notices, canRead);
    }
    return context;
  }

  function walk(dir) {
    if (limited || timeExpired()) return;
    let entries;
    try {
      entries = dir === root && rootEntries ? rootEntries : fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      const rel = displayPath(root, dir);
      incompleteDirectories.add(rel);
      notices.push({ code: "unreadable-directory", message: `Could not read ${rel}: ${error.message}` });
      return;
    }
    if (timeExpired()) return;
    const rootLevel = dir === root;
    const parentRel = rootLevel ? "" : displayPath(root, dir) + "/";
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const rel = parentRel + entry.name;
      if (rootLevel) rootDirectoryNames.add(entry.name);
      if (SKIP_DIRS.has(entry.name) || (rootLevel && ROOT_OUTPUT_DIRS.has(entry.name)) ||
          (isNonProductionSource(rel) && !isNonProductionSource(parentRel))) excludedFolders.add(rel);
    }
    if (rootLevel) {
      if (rootDirectoryNames.has(".git")) addLiteralIgnoreFolders(gitInfoExclude(root, limits, timeExpired), ignoreNames);
      // Artifact metadata has its own byte and file budget. When a root ignore file
      // is present, defer metadata reads until its rules are known (root files run first).
      if (!entries.some(entry => entry.name === ".gitignore" && entry.isFile())) artifactContext();
    }
    // Inspect root files and src before a large asset tree can exhaust the budget.
    function rootPriority(entry) {
      if (entry.name === "package.json" && entry.isFile()) return -1;
      if (!entry.isDirectory()) return 0;
      return entry.name === "src" ? 1 : 2;
    }
    entries.sort((a, b) => {
      const priority = dir === root ? rootPriority(a) - rootPriority(b) : 0;
      return priority || compareNames(a.name, b.name);
    });

    for (const entry of entries) {
      if (limited) break;
      if (timeExpired()) return;
      const absolute = path.join(dir, entry.name);
      if (!entry.isDirectory() && DESKTOP_METADATA.has(entry.name)) continue;
      const rel = displayPath(root, absolute);
      if (dir !== root && entry.name === "package.json" && !entry.isDirectory()) nestedPackages.push(rel);
      let stat;
      try { stat = fs.lstatSync(absolute); } catch {
        incompleteDirectories.add(displayPath(root, dir));
        continue;
      }
      if (timeExpired()) return;
      if (/(?:service-worker|sw)\.(?:js|ts)$/i.test(entry.name) && (stat.isSymbolicLink() || stat.isFile())) {
        workerPaths.push(displayPath(root, absolute));
      }
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
        const ignored = dir === root && ignoreNames.has(entry.name);
        const skipByName = SKIP_DIRS.has(entry.name) || (dir === root && ROOT_OUTPUT_DIRS.has(entry.name));
        const excluded = artifactContext().excludedDirectory(rel);
        if (excluded) {
          notices.push({ code: "project-artifact-excluded", message: `Excluded ${displayPath(root, absolute)}: ${excluded.reason}.`, actionable: false, classification: excluded.classification });
          continue;
        }
        const artifactClassification = WORKSPACE_ARTIFACT_DIRS.get(entry.name);
        if (artifactClassification) {
          notices.push({
            code: "workspace-artifact-excluded",
            message: `Excluded Workspace artifact folder ${rel}; its contents were not scanned as shipped project source.`,
            actionable: false,
            classification: artifactClassification,
          });
          continue;
        }
        if (!skipByName && !ignored) walk(absolute);
        continue;
      }
      if (!stat.isFile()) continue;
      const language = OTHER_LANGUAGES.get(path.extname(entry.name).toLowerCase());
      if (language) otherLanguages.add(language);
      const protectedFile = isProtectedFile(entry.name, rel);
      if (!protectedFile && WORKSPACE_ARTIFACT_FILE.test(entry.name)) {
        notices.push({
          code: "workspace-artifact-excluded",
          message: `Excluded Workspace artifact file ${rel}; it was not scanned as shipped project source.`,
          actionable: false,
          classification: "workspace-editor-backup",
        });
        continue;
      }
      if (files.length >= limits.maxFiles) return stop(`Stopped at the ${limits.maxFiles}-file bound.`);
      if (protectedFile) {
        files.push({ rel, absolute, size: stat.size, secret: true, binary: true, skipped: true, text: "", digest: `secret:${stat.size}` });
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
      try { buffer = fs.readFileSync(absolute); }
      catch (error) {
        if (rel === "package.json") {
          packageReadError = ["EACCES", "EPERM"].includes(error?.code) ? "access was denied" : "the file read failed";
        }
        notices.push({ code: "unreadable-file", message: `Could not read ${rel}.` });
        continue;
      }
      totalBytes += buffer.length;
      const packageProblem = entry.name === "package.json" ? packageReadProblem(buffer) : "";
      const sourceOrManifest = SOURCE_EXT.has(ext) || ext === ".json" || ext === ".webmanifest";
      const binary = buffer.subarray(0, 8192).includes(0) || (sourceOrManifest && hasUtf16Mark(buffer));
      if (binary && sourceOrManifest) {
        notices.push({ code: "binary-source-skipped", message: `Skipped ${rel} because it looks binary.`, actionable: false });
      }
      const text = binary ? "" : buffer.toString("utf8");
      if (rel === ".gitignore" && buffer.length === stat.size) addLiteralIgnoreFolders(buffer, ignoreNames);
      const file = { rel, absolute, size: buffer.length, binary, skipped: false, text, digest: hash(buffer) };
      if (packageProblem) file.packageProblem = packageProblem;
      files.push(file);
    }
  }

  walk(root);
  if (nestedPackages.length) notices.push({
    code: "nested-packages-not-judged", actionable: false,
    message: `Nested packages were not judged: ${nestedPackages.sort().join(", ")}.`,
  });
  const ignoredFolders = new Set([...ignoreNames].filter(name => rootDirectoryNames.has(name)));
  for (const [folders, code, label] of [
    [excludedFolders, "folders-not-judged", "Code rules excluded"],
    [ignoredFolders, "git-ignored-folders", "Git ignore rules excluded"],
  ]) {
    if (folders.size) notices.push({
      code, actionable: false,
      message: `${label} ${folders.size} folder${folders.size === 1 ? "" : "s"}: ${[...folders].sort().join(", ")}.`,
    });
  }
  files.sort((a, b) => compareNames(a.rel, b.rel));
  return { files, notices, otherLanguages, limited, totalBytes, workerPaths, incompleteDirectories, packageReadError, durationMs: Date.now() - started };
}

// A name can be present, absent, or uncheckable (permissions or a link boundary).
// A verified candidate wins even if another candidate could not be inspected.
function anyProjectFile(names, fileSet, root, probe) {
  let result = false;
  for (const name of names) {
    if (fileSet.has(name)) return true;
    const found = probe(path.resolve(root, name));
    if (found === true) return true;
    if (found === null) result = null;
  }
  return result;
}

function missingAfterCheck(found, subject, collected, incomplete = collected.limited) {
  if (found === true) return false;
  if (found === false && !incomplete) return true;
  collected.notices.push({
    code: "file-not-checked", actionable: false,
    message: `${subject} was not checked because the scan was incomplete or the path could not be verified.`,
  });
  return false;
}

function missingPackageEntry(entry, field, root, probe, collected) {
  const absolute = path.resolve(root, entry);
  const found = resolveNodeEntry(absolute, probe);
  if (found === true) return false;
  const subject = `package.json ${field} entry ${entry}`;
  const [first, next] = path.relative(root, absolute).split(path.sep);
  if (next && ["dist", "build", "out"].includes(first)) {
    const output = path.join(root, first);
    if (probe(output, "directory") === false && probe(output) === false) {
      collected.notices.push({
        code: "package-entry-not-built", actionable: false,
        message: `${subject}: not built yet, cannot confirm.`,
      });
      return false;
    }
  }
  return missingAfterCheck(found, subject, collected);
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
  if (deps["next-pwa"] || deps.workbox || deps["workbox-webpack-plugin"]) stack.add("PWA");
  if (names.has("pyproject.toml") || names.has("requirements.txt")) stack.add("Python");
  if (!stack.size) stack.add("Generic");
  return [...stack];
}

function resolveRelativeImport(file, spec, fileSet, root, probe, fileMap) {
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
  const extensions = typescript ? [...IMPORT_EXT, ".d.ts", ".node"] :
    [...IMPORT_EXT.filter(ext => ext !== ".ts" && ext !== ".tsx"), ".node"];
  const candidates = [
    ...substitutions.map((ext) => base.slice(0, -extension.length) + ext),
    ...extensions.map((ext) => base + ext),
    ...extensions.slice(1).map((ext) => path.posix.join(base, "index" + ext)),
  ];
  let unresolved = false;
  for (const rel of candidates) {
    if (fileSet.has(rel)) return true;
    const exists = probe(path.resolve(root, rel), "file", true);
    if (exists) return true;
    if (exists === null) unresolved = null;
  }

  // Use only manifest text the bounded scan already read. Looking up an
  // external or skipped directory may reveal a package, but not its main.
  const directory = path.resolve(root, base);
  const manifest = probe.locate(path.join(directory, "package.json"), "file", true);
  if (!manifest) return manifest === null ? null : unresolved;
  const metadata = fileMap.get(displayPath(root, manifest));
  if (!metadata || metadata.skipped || metadata.binary) return null;
  const { value: pkg, problem } = parsePackage(metadata);
  if (problem) return null;
  if (typeof pkg?.main !== "string" || !pkg.main) return unresolved;
  const resolved = resolveNodeEntry(path.resolve(directory, pkg.main), probe);
  return resolved === false ? unresolved : resolved;
}

function isTestPath(rel) {
  return /(?:^|\/)(?:tests?|__tests__|fixtures?)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(String(rel || ""));
}

// Trees a project keeps beside its source that are not the shipped product: scratch
// mockups and their drivers ("demos/..."), and a skill's starter code ("skills-library/
// <skill>/templates/..."). Top-level output folders are excluded during traversal. Narrow on purpose: the segment must be exactly "demos", so a root
// "demo-debug.js" is still ordinary source, and the template rule is anchored to a skill
// package, so an application's own "src/templates/app.js" still counts.
function isNonProductionSource(rel) {
  const value = String(rel || "");
  return /(?:^|\/)demos(?:\/|$)/.test(value)
    || /^skills-library\/[^/]+\/templates(?:\/|$)/.test(value);
}

// A script can mention a source path as data. Only command entry positions
// identify a CLI, including a quoted filename passed to the Node interpreter.
function declaredCliFiles(pkg) {
  const bins = typeof pkg?.bin === "string" ? [pkg.bin] : Object.values(pkg?.bin || {});
  const entries = new Set(bins.map(normalizeDeclaredPath).filter(Boolean));
  for (const command of Object.values(pkg?.scripts || {})) {
    if (typeof command !== "string") continue;
    let position = "command";
    const words = /"([^"\n]*)"|'([^'\n]*)'|([^\s;&|"'\n]+)|([;&|\n]+)/g;
    for (const match of command.matchAll(words)) {
      if (match[4]) { position = "command"; continue; }
      const token = match[1] ?? match[2] ?? match[3];
      if (position === "command" && /^[A-Za-z_]\w*=/.test(token)) continue;
      if (position === "command" && /^(?:node(?:\.exe)?|tsx|ts-node|bun)$/.test(path.posix.basename(token))) {
        position = "script";
      } else if (position !== "arguments") {
        if (position === "script" && token.startsWith("-")) continue;
        if (SOURCE_EXT.has(path.posix.extname(token).toLowerCase())) entries.add(normalizeDeclaredPath(token));
        position = "arguments";
      }
    }
  }
  return entries;
}

function reportVerdict(rawFindings, notices, reportDigest, timedOut) {
  // Expiration can follow an absence found earlier in the same audit.
  const absences = new Set(["missing-readme", "missing-package-entry", "missing-package-bin",
    "missing-test-script", "missing-lockfile", "broken-relative-import", "pwa-missing-manifest", "pwa-missing-worker"]);
  const evidence = timedOut ? rawFindings.filter(f => !absences.has(f.code)) : rawFindings.slice();
  for (const notice of notices) {
    if (notice.actionable === false) continue;
    evidence.push({
      code: notice.code, category: "coverage", severity: notice.code === "symlink-escape" ? "medium" : "low", confidence: notice.code === "symlink-escape" ? "likely" : "recommendation",
      message: notice.message, file: ".", line: 1,
      impact: "The static report does not cover every item in the project tree.",
      verify: "Review the skipped or bounded area separately if it is relevant.",
      recommendation: "Keep scan exclusions intentional and use an approved focused check when stronger coverage is needed.",
    });
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const confidenceRank = { confirmed: 0, likely: 1, recommendation: 2 };
  const findings = evidence.map((item) => makeFinding(reportDigest, item)).sort((a, b) =>
    (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
    (confidenceRank[a.confidence] ?? 9) - (confidenceRank[b.confidence] ?? 9) ||
    compareNames(a.file, b.file) || a.line - b.line || compareNames(a.code, b.code)
  );
  const count = (key, value) => findings.filter((finding) => finding[key] === value).length;
  const confirmed = count("confidence", "confirmed");
  const likely = count("confidence", "likely");
  const recommendation = count("confidence", "recommendation");
  const high = findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length;
  const status = confirmed || high ? "Needs attention" : findings.length ? "Watch" : "Healthy";
  const statusKey = status === "Needs attention" ? "attention" : status.toLowerCase();
  return { findings, status, statusKey, summary: { findings: findings.length, confirmed, likely, recommendation, high } };
}

function auditProject(options = {}) {
  const started = Date.now();
  const requested = path.resolve(String(options.projectPath || options.path || process.cwd()));
  const limits = normalizeLimits(options.limits);
  const projectId = String(options.projectId || path.basename(requested));
  const projectName = String(options.projectName || projectId);
  let root;
  let rootEntries;
  try {
    const stat = fs.statSync(requested);
    if (!stat.isDirectory()) throw new Error("Target is not a directory");
    root = fs.realpathSync(requested);
    rootEntries = fs.readdirSync(root, { withFileTypes: true });
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
      schemaVersion: 1, checkerVersion: CHECKER_VERSION, readOnly: true, projectId, projectName, root: requested,
      digest: reportDigest, status: "Unavailable", statusKey: "unavailable", stack: ["Unknown"],
      summary: { findings: 1, confirmed: 1, likely: 0, recommendation: 0, high: 1 },
      findings: [finding], notices: [coverageNotice(0, "")], limits, fileCount: 0, totalBytes: 0, durationMs: Date.now() - started,
      disclaimer: "Static evidence only. No project code was executed or changed.",
    };
  }

  const collected = collectProject(root, limits, rootEntries, started);
  let timedOut = false;
  function timeExpired() {
    if (!timedOut && Date.now() - started >= limits.maxDurationMs) {
      timedOut = true;
      collected.limited = true;
      const message = `Stopped after the ${limits.maxDurationMs}ms time bound.`;
      if (!collected.notices.some(n => n.code === "scan-limit" && n.message === message)) {
        collected.notices.push({ code: "scan-limit", message });
      }
    }
    return timedOut;
  }
  const probe = createPathProbe(root, requested, timeExpired);
  const fileMap = new Map(collected.files.map((file) => [file.rel, file]));
  const fileSet = new Set(fileMap.keys());
  const packageFile = fileMap.get("package.json");
  const parsed = timeExpired() ? { value: null } : parsePackage(packageFile);
  const digestInput = collected.files.map((file) => `${file.rel}\0${file.digest}`).join("\0");
  const reportDigest = hash(digestInput || `empty:${root}`);
  const rawFindings = [];
  const add = (data) => rawFindings.push(data);

  const manifestProblem = collected.packageReadError || packageFile?.packageProblem;
  if (manifestProblem) add({
    code: "unreadable-package-json", category: "structure", severity: "high", confidence: "confirmed",
    message: `Cannot read package.json as UTF-8 JSON because ${manifestProblem}.`, file: "package.json", line: 1,
    impact: "Package tooling cannot reliably read the project metadata.",
    verify: "Check read access, encoding and contents of package.json.",
    recommendation: "Make package.json readable as nonempty UTF-8 JSON and run the scan again.",
  });
  else if (parsed.problem) add({
    code: "package-not-examined", category: "coverage", severity: "low", confidence: "recommendation",
    message: `The root package.json was not examined because ${parsed.problem}.`, file: "package.json", line: 1,
    impact: "Package checks could not use the root metadata.", verify: "Check the structure of package.json.",
    recommendation: "Review the metadata and rerun the project check.",
  });
  else if (parsed.error) add({
    code: "malformed-package-json", category: "structure", severity: "high", confidence: "confirmed",
    message: `package.json is not valid JSON: ${parsed.error.message}`, file: "package.json", line: 1,
    impact: "Package tooling cannot reliably read the project metadata.",
    verify: "Parse package.json with a JSON parser.", recommendation: "Correct only the malformed JSON, then re-run the scan and package checks.",
  });

  const pkg = parsed.value;
  const stack = detectStack(collected.files, pkg);
  const readmeNames = rootEntries.filter(entry => /^readme(?:\.(?:md|markdown|txt|rst))?$/i.test(entry.name)).map(entry => entry.name);
  if (missingAfterCheck(anyProjectFile(readmeNames, fileSet, root, probe), "Root README.md", collected)) add({
    code: "missing-readme", category: "maintainability", severity: "low", confidence: "recommendation",
    message: "No root README.md was found.", file: ".", line: 1,
    impact: "Future contributors and agents must reverse-engineer how to run and verify the project.",
    verify: "Check whether operating instructions live in another intentional location.",
    recommendation: "Add a short README covering purpose, setup, run, test, and current behavior.",
  });

  if (pkg && !timeExpired()) {
    const main = typeof pkg.main === "string" ? pkg.main.replace(/^\.\//, "") : "";
    if (main && missingPackageEntry(main, "main", root, probe, collected)) add({
      code: "missing-package-entry", category: "bug", severity: "high", confidence: "confirmed",
      message: `package.json declares a missing main entry: ${main}`, file: "package.json", line: lineAt(packageFile.text, packageFile.text.indexOf('"main"')),
      impact: "Node or Electron cannot launch through the declared package entry.",
      verify: `Confirm that ${main} is absent with the same filename and case.`,
      recommendation: "Restore the entry file or correct the package main field.",
    });
    const bins = typeof pkg.bin === "string" ? [pkg.bin]
      : pkg.bin && typeof pkg.bin === "object" && !Array.isArray(pkg.bin) ? Object.values(pkg.bin) : [];
    const binEntries = new Set(bins.filter(value => typeof value === "string").map(value => value.replace(/^\.\//, "")));
    for (const entry of binEntries) {
      if (timeExpired()) break;
      if (entry && missingPackageEntry(entry, "bin", root, probe, collected)) add({
        code: "missing-package-bin", category: "bug", severity: "high", confidence: "confirmed",
        message: `package.json declares a missing bin entry: ${entry}`,
        file: "package.json", line: lineAt(packageFile.text, packageFile.text.indexOf('"bin"')),
        impact: "The declared command may fail to launch after installation.",
        verify: `Confirm that ${entry} is absent with the same filename and case.`,
        recommendation: "Restore the command file or correct the package bin field.",
      });
    }
    const scripts = pkg.scripts || {};
    const testScript = typeof scripts.test === "string" ? scripts.test.trim() : "";
    if (!testScript || /^echo\s+(["']?)(?:error:\s*)?no test specified\1\s*&&\s*exit\s+1$/i.test(testScript)) add({
      code: "missing-test-script", category: "tests", severity: "medium", confidence: "recommendation",
      message: "The package has no usable test script.", file: "package.json", line: lineAt(packageFile.text, Math.max(0, packageFile.text.indexOf('"scripts"'))),
      impact: "Regressions are harder to detect consistently across agents and machines.",
      verify: "Check for a test runner invoked outside package.json before adding a script.",
      recommendation: "Expose the smallest reliable automated test command through the package scripts.",
    });
    const dependencyCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
    const lockfiles = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
    if (dependencyCount && missingAfterCheck(anyProjectFile(lockfiles, fileSet, root, probe), "Dependency lockfile", collected)) add({
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
  const examinedSources = new Set();
  const importLimit = 24;
  let brokenImports = 0;
  importFiles: for (const file of runtimeSourceFiles) {
    if (timeExpired()) break;
    examinedSources.add(file.rel);
    for (const { index, spec, spelling } of relativeImportLiterals(file.text, file.rel)) {
      if (timeExpired()) break importFiles;
      const resolved = resolveRelativeImport(file, spec, fileSet, root, probe, fileMap);
      if (resolved === null) {
        collected.notices.push({ code: "import-not-checked", actionable: false, message: `Could not check relative import ${spelling} in ${file.rel}.` });
        continue;
      }
      if (resolved) continue;
      if (brokenImports === importLimit) {
        collected.notices.push({ code: "broken-import-limit", actionable: false, message: `Showing ${importLimit} broken relative imports. More exist.` });
        break importFiles;
      }
      brokenImports++;
      add({
        code: "broken-relative-import", category: "bug", severity: "high", confidence: "confirmed",
        message: `Relative import does not resolve: ${spelling}`, file: file.rel, line: lineAt(file.text, index),
        impact: "The importing module may fail to build or load.",
        verify: "Resolve the import with the project compiler and confirm filename case on disk.",
        recommendation: "Correct the import path or restore the missing module without changing unrelated imports.",
      });
    }
  }

  if (stack.includes("PWA") && !timeExpired()) {
    const hasManifest = [...fileSet].some((name) => /(?:^|\/)(?:manifest\.json|(?:manifest|site)\.webmanifest)$/i.test(name));
    const workerNames = ["service-worker.js", "service-worker.ts", "sw.js", "sw.ts"];
    const conventionalWorkers = ["", "public", "src"].flatMap(dir => workerNames.map(name => path.posix.join(dir, name)));
    const hasWorker = anyProjectFile([...collected.workerPaths, ...conventionalWorkers], fileSet, root, probe);
    const incompleteWorkerSearch = collected.limited || collected.incompleteDirectories.size > 0;
    if (!hasManifest && !incompleteWorkerSearch && !timeExpired()) add({ code: "pwa-missing-manifest", category: "structure", severity: "medium", confidence: "likely", message: "PWA tooling is present but no web app manifest was found.", file: "package.json", line: 1, impact: "Install metadata and standalone behavior may be incomplete.", verify: "Inspect framework-generated metadata and the built output before treating this as a defect.", recommendation: "Add or explicitly generate a valid web app manifest." });
    if (missingAfterCheck(hasWorker, "Source service worker", collected, incompleteWorkerSearch)) add({ code: "pwa-missing-worker", category: "performance", severity: "medium", confidence: "recommendation", message: "PWA tooling is present but no source service worker was found.", file: "package.json", line: 1, impact: "Offline and caching behavior may depend entirely on generated framework output.", verify: "Inspect the production build and registration path.", recommendation: "Document the generated worker or add an intentional offline strategy." });
  }

  const secretFiles = collected.files.filter((file) => file.secret);
  if (secretFiles.length) add({
    code: "secret-files-present", category: "security", severity: "high", confidence: "likely",
    message: `${secretFiles.length} secret-like file${secretFiles.length === 1 ? " is" : "s are"} present in the project tree; contents were not read.`, file: secretFiles[0].rel, line: 1,
    impact: "Secrets may be copied, committed, packaged, or exposed accidentally.",
    verify: "Confirm ignore rules and version-control status without printing secret values." +
      (secretFiles.length > 1 ? ` Files: ${secretFiles.map(file => file.rel).join(", ")}.` : ""),
    recommendation: "Keep secrets outside distributable source and document safe local configuration.",
  });

  const largeFiles = collected.files.filter((file) => file.size > 1024 * 1024 && !file.secret).sort((a, b) => b.size - a.size || compareNames(a.rel, b.rel));
  const oversized = [];
  const intentionalLarge = [];
  const nonProductionLarge = [];
  for (const file of largeFiles) {
    if (timeExpired()) break;
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
  for (const item of intentionalLarge.sort((a, b) => compareNames(a.file.rel, b.file.rel))) {
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
  const isElectron = stack.includes("Electron");
  const cliFiles = timeExpired() ? new Set() : declaredCliFiles(pkg);
  for (const file of runtimeSourceFiles) {
    if (timeExpired()) break;
    examinedSources.add(file.rel);
    const evidence = executableEvidence(file.text, isElectron, timeExpired);
    if (!evidence || timeExpired()) break;
    for (const [key, index] of evidence.settings) {
      const [, code, message, impact, recommendation] = electronRules.get(key);
      add({ code, category: "security", severity: "high", confidence: "likely", message, file: file.rel,
        line: lineAt(file.text, index), impact, verify: "Inspect the effective BrowserWindow webPreferences at runtime.", recommendation });
    }
    const todo = file.text.match(/\b(?:TODO|FIXME)\b/g);
    if (todo && todo.length) { todoCount += todo.length; if (!todoEvidence) todoEvidence = { file: file.rel, line: lineAt(file.text, file.text.search(/\b(?:TODO|FIXME)\b/)) }; }
    // Count output from explicitly unpackaged Electron tools for its existing notice.
    const toolOutput = Boolean(electronDependency && file.rel.startsWith("scripts/") &&
      normalizeDeclaredPath(pkg.main) !== file.rel && excludedByExplicitBuildFiles(file.rel, pkg));
    if (toolOutput) toolingLogs += (file.text.match(/\bconsole\.log\b/g) || []).length;
    const debug = evidence.debug;
    let firstDebug = debug[0];
    if (!toolOutput && !isExplicitNodeCli(file.text) && !evidence.mainGuard && !cliFiles.has(file.rel)) {
      for (const match of file.text.matchAll(/\bconsole\.log\b/g)) {
        debug.push(match.index);
        if (firstDebug === undefined || match.index < firstDebug) firstDebug = match.index;
      }
    }
    if (debug.length) { debugCount += debug.length; if (!debugEvidence) debugEvidence = { file: file.rel, line: lineAt(file.text, firstDebug) }; }
    const emptyCatch = file.text.match(/catch\s*(?:\([^()]*\)\s*)?\{\s*\}/g);
    if (emptyCatch && emptyCatch.length) { emptyCatchCount += emptyCatch.length; if (!emptyCatchEvidence) emptyCatchEvidence = { file: file.rel, line: lineAt(file.text, file.text.search(/catch\s*(?:\([^()]*\)\s*)?\{\s*\}/)) }; }
    if (evidence.dynamic.length) {
      dynamicExecCount += evidence.dynamic.length;
      if (!dynamicExecEvidence) dynamicExecEvidence = { file: file.rel, line: lineAt(file.text, evidence.dynamic[0]) };
    }
  }
  if (toolingLogs) collected.notices.push({
    code: "tooling-console-output", actionable: false, classification: "unpackaged-tool-output",
    message: `${toolingLogs} console.log occurrences belong to scripts excluded by the explicit Electron package files; executable debugger and other source checks still apply.`,
  });
  if (todoCount >= 8) add({ code: "todo-concentration", category: "maintainability", severity: "low", confidence: "recommendation", message: `${todoCount} TODO/FIXME markers remain in source files.`, ...todoEvidence, impact: "Deferred work may hide known gaps or make readiness unclear.", verify: "Review the markers and distinguish active work from stale notes.", recommendation: "Convert meaningful items into tracked work and remove obsolete markers." });
  if (debugCount >= 4) add({ code: "debug-residue", category: "performance", severity: "low", confidence: "recommendation", message: `${debugCount} debugger or console.log statements remain in source files.`, ...debugEvidence, impact: "Verbose production logging can expose data or add noise and small runtime cost.", verify: "Check the production build and intended logging policy.", recommendation: "Remove temporary statements or route intentional logs through the project logger." });
  if (emptyCatchCount) add({ code: "empty-catch", category: "bug", severity: "medium", confidence: "likely", message: `${emptyCatchCount} empty catch block${emptyCatchCount === 1 ? " suppresses" : "s suppress"} errors without evidence.`, ...emptyCatchEvidence, impact: "Failures may become silent and difficult to diagnose.", verify: "Exercise the surrounding failure path and inspect expected recovery behavior.", recommendation: "Handle, report, or deliberately document the swallowed error." });
  if (dynamicExecCount) add({ code: "dynamic-code-execution", category: "security", severity: "high", confidence: "likely", message: `${dynamicExecCount} dynamic code execution primitive${dynamicExecCount === 1 ? " was" : "s were"} found.`, ...dynamicExecEvidence, impact: "Untrusted input may become executable code if the call path is not tightly controlled.", verify: "Trace every input reaching the cited primitive.", recommendation: "Replace dynamic evaluation with explicit parsing or a constrained dispatch table." });

  const languages = [...collected.otherLanguages].sort().join(", ");
  collected.notices.push(coverageNotice(examinedSources.size, languages));
  if (!examinedSources.size && languages) add({
    code: "code-not-examined", category: "coverage", severity: "low", confidence: "recommendation",
    message: `${languages} code was not examined.`, file: ".", line: 1,
    impact: "Source issues in these languages can be absent from this report.",
    verify: "Review which languages have source files in this project.",
    recommendation: "Use a checker that examines those languages.",
  });

  const expiredBeforeReport = timeExpired();
  let verdict = reportVerdict(rawFindings, collected.notices, reportDigest, expiredBeforeReport);
  // Formatting and hashing evidence also consumes time. An expiry here needs
  // a final partial verdict, including the scan-limit notice just recorded.
  if (!expiredBeforeReport && timeExpired()) verdict = reportVerdict(rawFindings, collected.notices, reportDigest, true);
  return {
    schemaVersion: 1, checkerVersion: CHECKER_VERSION, readOnly: true, projectId, projectName, root, digest: reportDigest,
    status: verdict.status, statusKey: verdict.statusKey, stack, summary: verdict.summary,
    findings: verdict.findings, notices: collected.notices, limits, fileCount: collected.files.length,
    totalBytes: collected.totalBytes, durationMs: Date.now() - started,
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
    else if (argv[i] === "--version") out.version = true;
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
  if (args.version) {
    console.log(CHECKER_VERSION);
    process.exit(0);
  }
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
