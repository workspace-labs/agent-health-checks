"use strict";

const { isUtf8 } = require("node:buffer");

function hasUtf16Mark(buffer) {
  return (buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff);
}

function packageReadProblem(buffer) {
  if (!buffer.length) return "the file is empty";
  if (hasUtf16Mark(buffer)) return "the file is UTF-16";
  if (buffer.includes(0)) return "the file contains zero bytes";
  if (!isUtf8(buffer)) return "the file contains invalid UTF-8";
  return "";
}

const MAX_PACKAGE_DEPTH = 256;
class PackageDepthError extends RangeError {}

function parsePackageText(text) {
  const value = JSON.parse(text.replace(/^\uFEFF/, ""));
  // Both artifact exclusions and findings must use metadata that the checker
  // can process. Visit containers iteratively before either caller uses it.
  const pending = [[value, 1]];
  while (pending.length) {
    const [container, depth] = pending.pop();
    if (container === null || typeof container !== "object") continue;
    if (depth > MAX_PACKAGE_DEPTH) throw new PackageDepthError(`its nesting exceeds ${MAX_PACKAGE_DEPTH} levels`);
    for (const child of Object.values(container)) {
      if (child !== null && typeof child === "object") pending.push([child, depth + 1]);
    }
  }
  return value;
}

function parsePackage(file) {
  if (!file || file.packageProblem || !file.text) return { value: null, error: null };
  try { return { value: parsePackageText(file.text), error: null }; }
  catch (error) {
    if (error instanceof SyntaxError) return { value: null, error };
    const problem = error instanceof PackageDepthError ? error.message : "its metadata could not be processed";
    return { value: null, problem };
  }
}

module.exports = { hasUtf16Mark, packageReadProblem, parsePackageText, parsePackage };
