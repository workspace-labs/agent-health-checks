"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathNotice } = require("./project-report");
const { projectContext, gitInfoExclude, readIgnoreFile, addLiteralIgnoreFolders } = require("./project-context");
const { hasUtf16Mark, packageReadProblem } = require("./package-text");

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
  ".venv", "__pycache__", "node_modules", "DerivedData", ".idea", ".vscode",
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
const REFERENCE_DATA_EXT = new Set([".csv", ".tsv", ".jsonl", ".ndjson"]);

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

function hasZipSignature(absolute, listed, timeExpired) {
  if (listed.size < 4 || timeExpired()) return false;
  let fd;
  try {
    if (fs.realpathSync(absolute) !== absolute || timeExpired()) return false;
    fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== listed.dev || opened.ino !== listed.ino || timeExpired()) return false;
    const header = Buffer.alloc(4);
    return fs.readSync(fd, header, 0, 4, 0) === 4 && header.readUInt32BE(0) === 0x504b0304;
  } catch {
    return false; // An unverified .key keeps its protected classification.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
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

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isTestPath(rel) {
  return /(?:^|\/)(?:tests?|__tests__|fixtures?)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(String(rel || ""));
}

// Trees a project keeps beside its source that are not the shipped product: scratch
// mockups and their drivers ("demos/..."), and a skill's starter code ("skills-library/
// <skill>/templates/..."). Top-level output folders are excluded during traversal. Narrow on purpose: the segment must be exactly "demos", so a root
// "demo-debug.js" is still ordinary source, and the template rule is anchored to a skill
// package, so an application's own "src/templates/app.js" still counts.
function isNonProductionSource(rel, profile) {
  if (profile !== "workspace") return false;
  const value = String(rel || "");
  return /(?:^|\/)demos(?:\/|$)/.test(value)
    || /^skills-library\/[^/]+\/templates(?:\/|$)/.test(value);
}

function isRuntimeSource(rel, profile) {
  return SOURCE_EXT.has(path.posix.extname(rel).toLowerCase()) && !isTestPath(rel) && !isNonProductionSource(rel, profile);
}

function shouldSkipFolder(name, profile) {
  return SKIP_DIRS.has(name) || (profile === "workspace" && (name === ".pipeline" || WORKSPACE_ARTIFACT_DIRS.has(name)));
}

function collectProject(root, limits, rootEntries, started = Date.now(), profile) {
  const files = [];
  const pending = [];
  const unread = new Set();
  let admitted = 0;
  let linkCount = 0;
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
      context = projectContext(root, limits, notices, canRead, profile);
    }
    return context;
  }

  function walk(dir) {
    // A caller may already have listed the root when the deadline expires.
    // Retain names already in memory without starting another directory read.
    if (!(dir === root && rootEntries) && timeExpired()) return;
    let entries;
    try {
      entries = dir === root && rootEntries ? rootEntries : fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      const rel = displayPath(root, dir);
      incompleteDirectories.add(rel);
      notices.push(pathNotice(rel, { code: "unreadable-directory", message: `Could not read ${rel}: ${error.message}` }));
      return;
    }
    const rootLevel = dir === root;
    const parentRel = rootLevel ? "" : displayPath(root, dir) + "/";
    for (const entry of entries) {
      const rel = parentRel + entry.name;
      if (entry.isFile() && isRuntimeSource(rel, profile) && !isProtectedFile(entry.name, rel) &&
          !(profile === "workspace" && WORKSPACE_ARTIFACT_FILE.test(entry.name))) unread.add(rel);
      if (!entry.isDirectory()) continue;
      if (rootLevel) rootDirectoryNames.add(entry.name);
      if (shouldSkipFolder(entry.name, profile) || (rootLevel && ROOT_OUTPUT_DIRS.has(entry.name)) ||
          (isNonProductionSource(rel, profile) && !isNonProductionSource(parentRel, profile))) excludedFolders.add(rel);
    }
    if (timeExpired()) return;
    if (rootLevel) {
      if (rootDirectoryNames.has(".git")) addLiteralIgnoreFolders(gitInfoExclude(root, limits, timeExpired), ignoreNames);
      if (entries.some(entry => entry.name === ".gitignore" && entry.isFile())) {
        addLiteralIgnoreFolders(readIgnoreFile(path.join(root, ".gitignore"), limits, timeExpired), ignoreNames);
      }
      artifactContext();
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
      if (timeExpired()) return;
      const absolute = path.join(dir, entry.name);
      if (!entry.isDirectory() && DESKTOP_METADATA.has(entry.name)) continue;
      const rel = displayPath(root, absolute);
      if (dir !== root && entry.name === "package.json" && !entry.isDirectory()) nestedPackages.push(rel);
      // Once full, discover eligible names only. Never resolve another link or read another file.
      if (!entry.isDirectory() && admitted >= limits.maxFiles) {
        const exemptBackup = profile === "workspace" && entry.isFile() &&
          WORKSPACE_ARTIFACT_FILE.test(entry.name) && !isProtectedFile(entry.name, rel);
        if ((entry.isFile() || entry.isSymbolicLink()) && !exemptBackup) {
          stop(`Stopped at the ${limits.maxFiles}-file bound.`);
        }
        continue;
      }
      let stat;
      try { stat = fs.lstatSync(absolute); } catch {
        unread.delete(rel);
        incompleteDirectories.add(displayPath(root, dir));
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isFile()) unread.delete(rel);
      if (timeExpired()) return;
      if (/(?:service-worker|sw)\.(?:js|ts)$/i.test(entry.name) && (stat.isSymbolicLink() || stat.isFile())) {
        workerPaths.push(displayPath(root, absolute));
      }
      if (stat.isSymbolicLink()) {
        admitted++;
        linkCount++;
        let real = "";
        let resolutionCode = "";
        try { real = fs.realpathSync(absolute); }
        catch (error) { resolutionCode = error && error.code ? error.code : "unresolved"; }
        notices.push(pathNotice(rel, {
          code: resolutionCode ? "symlink-unresolved" : real && !inside(root, real) ? "symlink-escape" : "symlink-skipped",
          ...(real && inside(root, real) ? { actionable: false, classification: "in-project-symlink" } : {}),
          message: resolutionCode
            ? `Skipped unresolved symlink (${resolutionCode}): ${displayPath(root, absolute)}`
            : real && !inside(root, real) ? `Refused symlink escaping the project: ${displayPath(root, absolute)}` : `Skipped symlink: ${displayPath(root, absolute)}`,
        }));
        continue;
      }
      if (stat.isDirectory()) {
        const ignored = dir === root && ignoreNames.has(entry.name);
        const skipByName = shouldSkipFolder(entry.name, profile) || (dir === root && ROOT_OUTPUT_DIRS.has(entry.name));
        const excluded = artifactContext().excludedDirectory(rel);
        if (excluded) {
          notices.push(pathNotice(rel, { code: "project-artifact-excluded", message: `Excluded ${rel}: ${excluded.reason}.`, actionable: false, classification: excluded.classification }));
          continue;
        }
        const artifactClassification = profile === "workspace" && WORKSPACE_ARTIFACT_DIRS.get(entry.name);
        if (artifactClassification) {
          notices.push(pathNotice(rel, {
            code: "workspace-artifact-excluded",
            message: `Excluded Workspace artifact folder ${rel}; its contents were not scanned as shipped project source.`,
            actionable: false,
            classification: artifactClassification,
          }));
          continue;
        }
        if (!skipByName && !ignored) walk(absolute);
        continue;
      }
      if (!stat.isFile()) continue;
      const language = OTHER_LANGUAGES.get(path.extname(entry.name).toLowerCase());
      if (language) otherLanguages.add(language);
      const protectedFile = isProtectedFile(entry.name, rel);
      if (profile === "workspace" && !protectedFile && WORKSPACE_ARTIFACT_FILE.test(entry.name)) {
        notices.push(pathNotice(rel, {
          code: "workspace-artifact-excluded",
          message: `Excluded Workspace artifact file ${rel}; it was not scanned as shipped project source.`,
          actionable: false,
          classification: "workspace-editor-backup",
        }));
        continue;
      }
      admitted++;
      if (protectedFile) {
        // A name independently protected as .env.* stays unopened.
        const keyDocument = /\.key$/i.test(entry.name) && !/^\.env\./i.test(entry.name) &&
          hasZipSignature(absolute, stat, timeExpired);
        if (keyDocument) notices.push({
          code: "zip-key-document", actionable: false,
          message: `Skipped ${rel}: ZIP-format .key document.`,
        });
        files.push({ rel, absolute, size: stat.size, secret: !keyDocument, keyDocument, binary: true, skipped: true,
          text: "", digest: `${keyDocument ? "binary" : "secret"}:${stat.size}` });
        continue;
      }
      pending.push({ rel, absolute, size: stat.size, dev: stat.dev, ino: stat.ino, ext: path.extname(entry.name).toLowerCase() });
    }
  }

  function priority(file) {
    if (file.rel === "package.json") return 0;
    if (unread.has(file.rel)) return 1;
    if (!isTestPath(file.rel) && /(?:^|\/)(?:package\.json|manifest\.json|[^/]+\.webmanifest|[^/]+\.lock|[^/]*lock\.(?:json|yaml))$/i.test(file.rel)) return 2;
    return 3;
  }

  function binaryNotice(rel) {
    notices.push(pathNotice(rel, { code: "binary-source-skipped", message: `Skipped ${rel} because it looks binary.`, actionable: false }));
  }

  function recordOversized(file, size, binary = false, incompletePrefix = false) {
    const { rel, absolute } = file;
    if (binary) {
      binaryNotice(rel);
    } else {
      const reference = isIntentionalReferenceData(rel);
      const message = `Skipped ${rel}; it exceeds ${limits.maxFileBytes} bytes.`;
      notices.push(pathNotice(rel, {
        code: "oversized-text",
        message: incompletePrefix ? message + " The byte budget ended before its type could be determined." : message,
        actionable: !reference,
        ...(incompletePrefix ? {} : { classification: reference ? "reference-data" : "unclassified-text" }),
      }));
    }
    files.push({ rel, absolute, size, binary, skipped: true, text: "", digest: `${binary ? "binary" : "oversized"}:${size}` });
  }

  walk(root);
  pending.sort((a, b) => priority(a) - priority(b) || compareNames(a.rel, b.rel));
  const byteLimitMessage = `Stopped at the ${limits.maxTotalBytes}-byte text bound.`;
  for (const file of pending) {
    if (timeExpired()) break;
    const { rel, absolute, ext } = file;
    if (BINARY_EXT.has(ext)) {
      binaryNotice(rel);
      files.push({ rel, absolute, size: file.size, binary: true, skipped: false, text: "", digest: `binary:${file.size}` });
      continue;
    }
    if (file.size > limits.maxFileBytes && ext) {
      recordOversized(file, file.size);
      continue;
    }
    let fd;
    try {
      if (fs.realpathSync(absolute) !== absolute) throw new Error("File changed");
      if (timeExpired()) break;
      fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      if (timeExpired()) break;
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.dev !== file.dev || stat.ino !== file.ino) throw new Error("File changed");
      if (timeExpired()) break;
      const size = stat.size;
      const oversized = size > limits.maxFileBytes;
      if (oversized && ext) {
        recordOversized(file, size);
        continue;
      }
      const remainingBytes = limits.maxTotalBytes - totalBytes;
      if (!oversized && size > remainingBytes) {
        stop(byteLimitMessage);
        break;
      }
      const prefixSize = Math.min(size, 8000);
      const wanted = oversized ? Math.min(prefixSize, remainingBytes) : size;
      const buffer = Buffer.alloc(wanted);
      let offset = 0;
      while (offset < wanted && !timeExpired()) {
        const count = fs.readSync(fd, buffer, offset, wanted - offset, offset);
        totalBytes += count;
        if (count === 0) throw new Error("File changed");
        offset += count;
      }
      if (timeExpired()) {
        if (!oversized && offset === size) unread.delete(rel);
        break;
      }
      if (fs.fstatSync(fd).size !== size) throw new Error("File changed");
      const sourceOrManifest = SOURCE_EXT.has(ext) || ext === ".json" || ext === ".webmanifest";
      const binary = buffer.subarray(0, ext ? 8192 : 8000).includes(0) || (sourceOrManifest && hasUtf16Mark(buffer));
      if (oversized) {
        const incompletePrefix = !binary && wanted < prefixSize;
        recordOversized(file, size, binary, incompletePrefix);
        if (incompletePrefix) { stop(byteLimitMessage); break; }
        continue;
      }
      if (binary) binaryNotice(rel);
      unread.delete(rel);
      const entry = { rel, absolute, size, binary, skipped: false, text: binary ? "" : buffer.toString("utf8"), digest: hash(buffer) };
      if (path.basename(rel) === "package.json") {
        const problem = packageReadProblem(buffer);
        if (problem) entry.packageProblem = problem;
      }
      files.push(entry);
    } catch (error) {
      unread.delete(rel);
      if (rel === "package.json") packageReadError = ["EACCES", "EPERM"].includes(error?.code) ? "access was denied" : "the file read failed";
      notices.push(pathNotice(rel, { code: "unreadable-file", message: `Could not read ${rel}.` }));
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
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
  return { files, notices, unreadSources: [...unread].sort(), linkCount, otherLanguages, limited, totalBytes, workerPaths, incompleteDirectories, packageReadError, durationMs: Date.now() - started };
}

module.exports = { collectProject, displayPath, compareNames, inside, hash, isIntentionalReferenceData,
  SOURCE_EXT, isRuntimeSource, isNonProductionSource };
