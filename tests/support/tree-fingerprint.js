"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Capture names, modes, modification times and file contents. Reading a file may
// legitimately change its access time, so that field is deliberately omitted.
function hashTree(root) {
  const records = [];
  function visit(file) {
    const stat = fs.lstatSync(file);
    let value = "";
    if (stat.isSymbolicLink()) value = fs.readlinkSync(file);
    if (stat.isFile()) value = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    records.push([path.relative(root, file), stat.mode, stat.mtimeMs, value]);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
    }
  }
  visit(root);
  return crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

module.exports = { hashTree };
