"use strict";

// Escape individual output lines before adding the renderer's own line breaks.
function terminalText(text) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/g,
    ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

const location = Symbol("notice path");
const groupedDescriptions = {
  "binary-source-skipped": "binary files skipped",
  "file-not-checked": "package entries that could not be checked",
  "intentional-large-asset": "intentional large assets retained",
  "oversized-text": "files skipped for size",
  "package-entry-not-built": "package entries awaiting build output",
  "project-artifact-excluded": "generated project items excluded",
  "symlink-escape": "links outside the project refused",
  "symlink-skipped": "links inside the project skipped",
  "symlink-unresolved": "unresolved links skipped",
  "unreadable-directory": "folders that could not be read",
  "unreadable-file": "files that could not be read",
  "workspace-artifact-excluded": "Workspace artifacts excluded",
};

// Keep the collector's public notice shape while carrying the exact path to the renderer.
function pathNotice(rel, notice) {
  return Object.defineProperty(notice, location, { value: rel });
}

function groupPathNotices(notices) {
  const groups = new Map();
  for (const notice of notices) {
    if (notice[location] === undefined) continue;
    if (!groups.has(notice.code)) groups.set(notice.code, []);
    groups.get(notice.code).push(notice);
  }
  const result = [];
  for (const notice of notices) {
    const group = groups.get(notice.code);
    if (!group || notice[location] === undefined || group.length === 1) {
      result.push(notice);
      continue;
    }
    if (group[0] !== notice) continue;
    const examples = group.slice(0, 10);
    const classification = notice.classification;
    const sameClass = group.every(item => item.classification === classification);
    const sample = group.length > examples.length ? " (first " + examples.length + ")" : "";
    const details = examples.map(item => {
      if (!sameClass && item.classification) return item[location] + " (" + item.classification + ")";
      return item[location];
    });
    result.push({
      code: notice.code,
      message: `${group.length} ${groupedDescriptions[notice.code] || "entries"}${sample}: ${details.join(", ")}.`,
      count: group.length,
      ...(group.some(item => item.actionable !== undefined)
        ? { actionable: group.some(item => item.actionable !== false) } : {}),
      ...(sameClass && classification ? { classification } : {}),
    });
  }
  return result;
}

function terminalPriority(finding) {
  if (finding.severity === "critical") return 0;
  if (finding.severity === "high") return 1;
  return finding.code === "source-not-read" ? 2 : 3;
}

function humanReport(report) {
  const lines = [
    `Universal Project Doctor — ${report.projectName}`,
    `${report.status} · ${report.stack.join(" / ")} · ${report.fileCount} files · ${report.durationMs}ms`,
    `Confirmed ${report.summary.confirmed} · Likely ${report.summary.likely} · Recommendations ${report.summary.recommendation}`,
    "",
  ];
  const groups = new Map();
  for (const item of report.findings) {
    if (!groups.has(item.code)) groups.set(item.code, { first: item, count: 0 });
    groups.get(item.code).count++;
  }
  const ordered = [...groups.values()].sort((a, b) => terminalPriority(a.first) - terminalPriority(b.first));
  let omitted = 0;
  for (const [index, { first, count }] of ordered.entries()) {
    if (index >= 8 && terminalPriority(first) > 2) {
      omitted += count;
      continue;
    }
    const repeat = count > 1 ? ` ×${count}` : "";
    lines.push(`[${first.severity.toUpperCase()} · ${first.confidence}] ${first.message}${repeat}`);
    lines.push(`  ${first.file}:${first.line} · ${first.category} · ${first.code}`);
    lines.push(`  Impact: ${first.impact}`, `  Verify: ${first.verify}`, `  Recommendation: ${first.recommendation}`, "");
  }
  if (omitted) lines.push(`… ${omitted} ${omitted === 1 ? "finding" : "findings"} not shown`, "");
  if (!report.findings.length) lines.push("No static findings in the bounded scan.", "");
  if (report.notices.length) {
    lines.push(`Scan boundaries (${report.notices.length})`);
    for (const notice of report.notices) lines.push(`  [${notice.classification || notice.code}] ${notice.message}`);
    lines.push("");
  }
  lines.push(report.disclaimer);
  return lines.map(terminalText).join("\n");
}

module.exports = { pathNotice, groupPathNotices, humanReport, terminalText };
