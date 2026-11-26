"use strict";

const { finding } = require("./skill-findings");
const { excerpt } = require("./skill-excerpt");

const write = String.raw`(?:\b(?:append|add|write|insert|save|put|copy|inject|modify|update|rewrite|overwrite|edit|tee)\b|>>)`;
const target = String.raw`(?:CLAUDE\.md|AGENTS\.md|GEMINI\.md|MEMORY\.md|SOUL\.md|\.claude[/\\]settings(?:\.local)?\.json|settings\.local\.json|\.codex[/\\]config\.toml|\.mcp\.json|\.cursorrules|(?:~|\$HOME)[/\\]\.(?:bashrc|zshrc|zprofile|bash_profile|profile)|crontab|LaunchAgents)`;
// Permit path separators and sentence punctuation, but not a piece of a
// different filename (for example, demo-AGENTS.md or .mcp.json.example).
const pattern = new RegExp(write + String.raw`.{0,100}?(?<![\w.-])(` + target + String.raw`)(?![\w-]|\.[\w.-])`, "iu");

function standingFileFindings(file) {
  const lines = file.text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const hit = pattern.exec(line);
    if (hit) return [finding("safety", "info", "standing-file-write",
      "Writes into an agent's standing file: " + excerpt(hit[1]), file.rel, index + 1,
      "This change stays after the skill is removed; check it is wanted.")];
  }
  return [];
}

module.exports = { standingFileFindings };
