"use strict";

const { comparePath } = require("./skill-paths");

const AXES = ["structure", "triggers", "safety", "portability", "claude", "codex"];

function finding(axis, severity, code, message, file, line, suggestion) {
  return { axis, severity, code, message, file: file || "SKILL.md", line: line || 1, suggestion: suggestion || "Review this evidence before changing the skill." };
}

function finalizeStatus(skill) {
  const commonFail = skill.axes.structure === "fail";
  const workspace = skill.findings.some((f) => f.code === "personal-path");
  const safetyReview = skill.axes.safety !== "pass";
  if (commonFail) { skill.status = "Broken"; skill.statusKey = "broken"; }
  else if (safetyReview) { skill.status = "Needs review"; skill.statusKey = "review"; }
  else if (workspace) { skill.status = "Workspace-specific"; skill.statusKey = "workspace"; }
  else if (skill.axes.claude === "pass" && skill.axes.codex !== "pass") { skill.status = "Claude-ready"; skill.statusKey = "claude"; }
  else if (skill.axes.codex === "pass" && skill.axes.claude !== "pass") { skill.status = "Codex-ready"; skill.statusKey = "codex"; }
  else if (skill.findings.some(f => f.severity !== "info")) { skill.status = "Needs review"; skill.statusKey = "review"; }
  else { skill.status = "Universal"; skill.statusKey = "universal"; }
  const rank = { error: 0, review: 1, info: 2 };
  skill.findings.sort((a, b) => (rank[a.severity] - rank[b.severity]) || AXES.indexOf(a.axis) - AXES.indexOf(b.axis) || comparePath(a.file, b.file) || a.line - b.line);
  skill.counts = {
    errors: skill.findings.filter(f => f.severity === "error").length,
    review: skill.findings.filter(f => f.severity === "review").length,
    info: skill.findings.filter(f => f.severity === "info").length,
  };
  delete skill._dirReal;
  return skill;
}

module.exports = { AXES, finding, finalizeStatus };
