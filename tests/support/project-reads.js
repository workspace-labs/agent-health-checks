"use strict";

const fs = require("node:fs");

// Watch pathname reads in the metadata reader and descriptor opens in the collector.
// Some fixtures install the watch before they write their test files.
function watchFileReads(t, observe) {
  const read = fs.readFileSync;
  const open = fs.openSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (typeof file === "string") observe(file);
    return read(file, ...args);
  });
  t.mock.method(fs, "openSync", (file, flags, ...args) => {
    const readOnly = typeof flags === "number" ? (flags & 3) === fs.constants.O_RDONLY : flags === "r";
    if (readOnly && typeof file === "string") observe(file);
    return open(file, flags, ...args);
  });
}

module.exports = { watchFileReads };
