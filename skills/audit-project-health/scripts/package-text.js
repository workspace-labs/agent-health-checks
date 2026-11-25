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

function parsePackageText(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

module.exports = { hasUtf16Mark, packageReadProblem, parsePackageText };
