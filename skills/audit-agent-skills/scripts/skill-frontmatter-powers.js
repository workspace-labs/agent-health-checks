"use strict";

const { finding } = require("./skill-findings");
const { excerpt } = require("./skill-excerpt");

// A comma or space separates grants only outside the parenthesized scope.
function broadGrant(tools) {
  for (const grants of Array.isArray(tools) ? tools : [tools]) {
    if (typeof grants !== "string") continue;
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= grants.length; i++) {
      const ch = grants[i];
      if (ch === "(") depth++;
      else if (ch === ")" && depth) depth--;
      else if (i === grants.length || (!depth && (ch === "," || /\s/.test(ch)))) {
        const token = grants.slice(start, i);
        if (/^Bash(?:\([ *:]*\))?$/.test(token)) return token;
        start = i + 1;
      }
    }
  }
}

// The bounded YAML reader reports unverified-yaml for some otherwise simple
// flow lists, including [Read, Bash(*)]. For that field only, accept a complete
// flat list of tool scalars. Keep the original parser finding in the report.
function flowGrants(parsed) {
  if (!parsed.unknownFields?.has("allowed-tools")) return;
  const lines = parsed.front.split(/\r?\n/);
  const index = parsed.lines["allowed-tools"] - 2;
  let end = lines.length;
  for (const line of Object.values(parsed.lines)) {
    if (line - 2 > index) end = Math.min(end, line - 2);
  }
  const source = lines.slice(index, end).join("\n");
  // Each match must start exactly where the previous separator ended.
  const trivia = /(?:\s+|#[^\n]*)*/y;
  const item = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\n]|'')*'|[A-Za-z][\w.-]*(?:\([^()#,\[\]\n]*\))?/y;
  const values = [];
  let offset = source.indexOf(":") + 1;
  function skipTrivia() {
    trivia.lastIndex = offset;
    offset += trivia.exec(source)[0].length;
  }
  skipTrivia();
  if (source[offset++] !== "[") return;
  while (offset < source.length) {
    skipTrivia();
    if (source[offset] === "]") {
      offset++;
      skipTrivia();
      return offset === source.length ? values : undefined;
    }
    item.lastIndex = offset;
    const match = item.exec(source);
    if (!match) return;
    let value = match[0];
    if (value[0] === '"') {
      try { value = JSON.parse(value); } catch { return; }
    } else if (value[0] === "'") value = value.slice(1, -1).replace(/''/g, "'");
    values.push(value);
    offset = item.lastIndex;
    skipTrivia();
    if (source[offset] === ",") offset++;
    else if (source[offset] !== "]") return;
  }
}

function frontmatterPowers(parsed) {
  const { fm, lines } = parsed;
  if (!lines) return [];
  const findings = [];
  if (Object.hasOwn(lines, "hooks")) {
    const hooks = fm.hooks;
    const events = hooks && typeof hooks === "object" && !Array.isArray(hooks) ? Object.keys(hooks) : [];
    findings.push(finding("safety", "review", "frontmatter-hooks",
      "Declares hooks that run commands automatically: " + excerpt(events.join(", ") || "event names unavailable"),
      "SKILL.md", lines.hooks, "Read the commands attached to these hook events."));
  }
  const grant = broadGrant(fm["allowed-tools"] ?? flowGrants(parsed));
  if (grant) findings.push(finding("safety", "review", "unrestricted-shell-grant",
    "Pre-approves any shell command: " + excerpt(grant), "SKILL.md", lines["allowed-tools"],
    "Check that the skill needs unrestricted shell access."));
  if (["false", "False", "FALSE"].includes(fm["user-invocable"])) findings.push(finding("safety", "info", "hidden-from-menu",
    "Hidden from the skills menu; the agent can still start it on its own", "SKILL.md", lines["user-invocable"],
    "Review when the agent is instructed to use this skill."));
  return findings;
}

module.exports = { frontmatterPowers };
