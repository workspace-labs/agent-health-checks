"use strict";

const { finding } = require("./skill-findings");
const { downloadAndRun, decodeAndRun } = require("./skill-pipelines");
const { credentialAccess, safeguardOff } = require("./skill-settings");
const { hiddenCharacters } = require("./skill-invisible");

const rules = [
  {
    code: "download-and-run", match: downloadAndRun, message: "Downloads a script and runs it at once",
    suggestion: "Read the downloaded script first; ask the person before any step that runs code from the internet.",
  },
  {
    code: "credential-access", match: credentialAccess, message: "Reads a stored login secret",
    suggestion: "Confirm why the skill needs it and where it is sent; a skill should not move secrets off the computer.",
  },
  {
    code: "decode-and-run", match: decodeAndRun, message: "Decodes hidden text and runs it",
    suggestion: "Decode the text by hand and read it before trusting the skill.",
  },
  {
    code: "safeguard-off", match: safeguardOff, message: "Turns a safeguard off",
    suggestion: "Keep the safeguard on; a skill should not need approvals, certificate checks or download protection switched off.",
  },
];

function excerpt(text) {
  // Format controls in a quoted command must also be visible when it shares a line with hidden text.
  // Each 80-character end fits in 160 UTF-16 units. Bound escaping even for a megabyte-long match.
  const sample = text.length > 320 ? text.slice(0, 160) + "…" + text.slice(-160) : text;
  const visible = sample.replace(/[\u200b-\u200d\u202a-\u202e\u2060\u2066-\u2069\ufeff\ufe00-\ufe0f\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu,
    ch => "\\u{" + ch.codePointAt(0).toString(16) + "}");
  const chars = Array.from(visible);
  return chars.length <= 80 ? visible : chars.slice(0, 52).join("") + "…" + chars.slice(-27).join("");
}

function textSafetyFindings(file) {
  const findings = [];
  const hidden = hiddenCharacters(file.text);
  if (hidden) findings.push(finding("safety", "review", "hidden-characters",
    `Text holds ${hidden.count} invisible or direction-changing characters (${hidden.kind})`, file.rel, hidden.line,
    "Open the file in a hex view; remove the characters unless they are ordinary writing."));

  const lines = file.text.split(/\r?\n/);
  for (const rule of rules) {
    for (let i = 0; i < lines.length; i++) {
      const evidence = rule.match(lines[i]);
      if (evidence) {
        findings.push(finding("safety", "review", rule.code, rule.message + ": " + excerpt(evidence),
          file.rel, i + 1, rule.suggestion));
        break;
      }
    }
  }
  return findings;
}

module.exports = { textSafetyFindings };
