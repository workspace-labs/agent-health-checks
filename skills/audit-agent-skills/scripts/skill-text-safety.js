"use strict";

const { finding } = require("./skill-findings");
const { downloadAndRun, decodeAndRun } = require("./skill-pipelines");
const { credentialAccess, safeguardOff } = require("./skill-settings");
const { hiddenCharacters } = require("./skill-invisible");
const { excerpt } = require("./skill-excerpt");

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
