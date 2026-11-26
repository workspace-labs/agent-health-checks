"use strict";

function parseCli(argv) {
  const roots = [];
  let json = false, includeBody = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--include-body") includeBody = true;
    else if (argv[i] === "--version") return { version: true };
    else if (argv[i] === "--root") {
      const spec = argv[++i];
      if (!spec || spec.startsWith("-")) throw new Error("--root requires a path");
      const split = spec.indexOf("=");
      const prefix = spec.slice(0, split);
      const labelled = split > 0 && !/[\\/:]/.test(prefix) && !/^[.~]/.test(prefix);
      const rootPath = labelled ? spec.slice(split + 1) : spec;
      if (!rootPath.trim()) throw new Error("--root requires a path");
      roots.push({ id: labelled ? prefix : `root-${roots.length + 1}`, label: labelled ? prefix : `Root ${roots.length + 1}`, path: rootPath });
    } else if (argv[i] === "--help" || argv[i] === "-h") return { help: true };
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return { roots, json, includeBody };
}

function compactSkill({ body, frontmatter, ...skill }) {
  return {
    ...skill,
    bodyBytes: Buffer.byteLength(body),
    frontmatterBytes: Buffer.byteLength(JSON.stringify(frontmatter)),
  };
}

// Escape individual output lines before adding the renderer's own line breaks.
function terminalText(text) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/g,
    ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

function printFindings(findings) {
  const groups = new Map();
  for (const item of findings) {
    if (!groups.has(item.code)) groups.set(item.code, { first: item, count: 0, suggestions: new Set() });
    const group = groups.get(item.code);
    group.count++;
    group.suggestions.add(item.suggestion);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    Number(b.first.axis === "safety") - Number(a.first.axis === "safety"));
  let omitted = 0;
  for (const [index, { first, count, suggestions }] of ordered.entries()) {
    if (index >= 8 && first.axis !== "safety") {
      omitted += count;
      continue;
    }
    const level = first.severity === "error" ? "ERROR" : "REVIEW";
    const repeat = count > 1 ? ` ×${count}` : "";
    console.log(terminalText(`  ${level} ${first.axis} · ${first.file}:${first.line} · ${first.message}${repeat} · ${[...suggestions].join(" ")}`));
  }
  if (omitted) console.log(`  … ${omitted} ${omitted === 1 ? "finding" : "findings"} not shown`);
}

function printHuman(report, explicitRoots) {
  for (const root of report.roots) {
    if (explicitRoots || root.state !== "missing") {
      console.log(terminalText(`${root.label} (${root.path}) — ${root.state}`));
      if (root.notSearched) console.log(terminalText(`  not searched: ${root.notSearched.join(", ")}`));
    }
  }
  if (report.coverage?.length) {
    console.log("Not checked");
    for (const entry of report.coverage) {
      console.log(terminalText(`  ${entry.path} (${entry.kind}): ${entry.count} SKILL.md${entry.partial ? " (partial count)" : ""}`));
    }
  }
  const s = report.summary.statuses;
  console.log(`Skills Checker — ${report.summary.skills} unique skills (${report.summary.mirrors} identical mirrors)`);
  console.log(`Universal ${s.universal} · Claude-ready ${s.claude} · Codex-ready ${s.codex} · Workspace-specific ${s.workspace} · Needs review ${s.review} · Broken ${s.broken}`);
  console.log(report.disclaimer);
  const characters = report.summary.descriptionCharacters;
  if (characters) console.log(`Description characters — Claude ${characters.claude} (1% of context window estimate) · Codex ${characters.codex} (2% of context window, 8,000 characters when unknown, estimate)`);
  if (report.summary.closestPairs) {
    console.log("Closest descriptions");
    for (const { names, score } of report.summary.closestPairs) {
      console.log(terminalText(`  ${names[0]} / ${names[1]} — ${(score * 100).toFixed(1)}%`));
    }
  }
  for (const skill of report.skills) {
    console.log("");
    console.log(terminalText(`${skill.status.padEnd(18)} ${skill.name}  [${skill.sources.map(source => source.isLink ? source.label + " (link)" : source.label).join(", ")}]`));
    printFindings(skill.findings);
  }
}

module.exports = { parseCli, compactSkill, terminalText, printHuman };
