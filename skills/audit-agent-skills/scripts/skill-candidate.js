"use strict";

const { sourceLocation } = require("./skill-paths");
const { AXES, finding } = require("./skill-findings");
const { lineOf, scalar, readYaml, parseFrontmatter, yamlFinding } = require("./skill-yaml");
const { collectFiles, digestFiles } = require("./skill-files");
const { markdownFile, referencesIn, referenceInspector, needsContents, indirectReferences } = require("./skill-references");
const { personalPath, contentSafety } = require("./skill-safety");
const { textSafetyFindings } = require("./skill-text-safety");

const SHARED_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const CLAUDE_FIELDS = new Set([
  "when_to_use", "argument-hint", "arguments", "disable-model-invocation", "user-invocable",
  "disallowed-tools", "model", "effort", "context", "agent", "background", "hooks", "paths", "shell",
]);

function checkFrontmatterFields(parsed, description, findings) {
  const { fm, lines } = parsed;
  if (Object.hasOwn(lines, "allowed-tools")) {
    findings.push(finding("portability", "review", "allowed-tools-extension",
      "The Agent Skills specification marks allowed-tools as experimental", "SKILL.md", lines["allowed-tools"],
      "Document the dependency and provide a portable fallback."));
  }
  const extraFields = Object.keys(lines).filter(key => !SHARED_FIELDS.has(key)).sort((a, b) => lines[a] - lines[b]);
  if (extraFields.length) {
    const labels = extraFields.map(key => key + (CLAUDE_FIELDS.has(key) ? " (Claude Code)" : " (product unconfirmed)"));
    findings.push(finding("portability", "review", "extra-frontmatter-fields",
      "Fields outside the Agent Skills specification: " + labels.join(", "), "SKILL.md", lines[extraFields[0]],
      "Document which product reads these fields and how to use the skill on other agents."));
  }
  if (typeof fm.compatibility === "string" && Array.from(fm.compatibility).length > 500) {
    findings.push(finding("structure", "error", "compatibility-too-long", "Compatibility exceeds the 500-character limit",
      "SKILL.md", lines.compatibility, "Shorten compatibility to 500 characters or fewer."));
  }
  if (typeof fm.name === "string" && /[<>]/.test(fm.name)) {
    findings.push(finding("claude", "review", "claude-name-angle-bracket",
      "Claude uploads reject angle brackets in the name. Claude Code rejects this frontmatter name. The skill can still load under a valid folder name.",
      "SKILL.md", lines.name, "Use a lowercase hyphenated name matching the skill folder."));
  }
  if (/[<>]/.test(description)) {
    findings.push(finding("claude", "review", "claude-description-angle-bracket",
      "Claude uploads reject angle brackets in the description. Claude Code accepts them and displays &lt; and &gt;.",
      "SKILL.md", lines.description, "Use square brackets or plain text in the description."));
  }
}

// Exact capability identifiers. Common verbs such as Read and Stop also occur
// in ordinary instructions, so they cannot identify a product from prose.
const CLAUDE_CAPABILITIES = [
  "AskUserQuestion", "CronCreate", "CronDelete", "CronList", "EndConversation", "EnterPlanMode",
  "EnterWorktree", "ExitPlanMode", "ExitWorktree", "ListAgents", "ListMcpResourcesTool",
  "ListPlugins", "ListSkills", "NotebookEdit", "propose_skills", "PushNotification",
  "ReadMcpResourceTool", "RemoteTrigger", "ReportFindings", "ScheduleWakeup", "SearchPlugins",
  "SearchSkills", "SendFeedback", "SendMessage", "SendUserFile", "ShareOnboardingGuide",
  "SubagentHandback", "SuggestPluginInstall", "SuggestSkills", "TaskCreate", "TaskGet",
  "TaskList", "TaskOutput", "TaskStop", "TaskUpdate", "TodoWrite", "ToolSearch", "WaitForMcpServers",
  "WebFetch", "UserPromptExpansion", "PreSkillShellCommand", "PermissionDenied", "PostToolBatch",
  "PostToolUseFailure", "MessageDisplay", "TaskCreated", "TaskCompleted", "StopFailure",
  "TeammateIdle", "InstructionsLoaded", "ConfigChange", "CwdChanged", "DirectoryAdded",
  "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreModelSwitch", "PostModelSwitch", "ElicitationResult",
];
const CODEX_CAPABILITIES = [
  "request_user_input", "apply_patch", "exec_command", "write_stdin", "update_plan",
  "spawn_agent", "send_input", "send_message", "followup_task", "resume_agent", "wait_agent",
  "list_agents", "close_agent", "interrupt_agent", "PreModelRequest", "PostModelRequest",
];
const SHARED_CAPABILITIES = [
  "PreToolUse", "PostToolUse", "PreCompact", "PostCompact", "PermissionRequest",
  "UserPromptSubmit", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "WebSearch",
];

function undeclaredCapabilities(compatibility) {
  const claude = /\bclaude\b/i.test(compatibility);
  const codex = /\bcodex\b/i.test(compatibility);
  if (claude && codex) return null;
  const names = [];
  if (!claude) names.push(...CLAUDE_CAPABILITIES);
  if (!codex) names.push(...CODEX_CAPABILITIES);
  if (!claude && !codex) names.push(...SHARED_CAPABILITIES);
  return new RegExp("\\b(?:" + names.join("|") + ")\\b");
}

function auditCandidate(candidate, limits) {
  const { root, rootReal, dir, dirReal, folder } = candidate;
  const collected = collectFiles(dirReal, rootReal, limits, candidate.discoveryDepth);
  const skillFile = collected.files.find((f) => f.rel === "SKILL.md" && !f.binary && !f.skipped);
  const findings = [];
  for (const note of collected.notices) findings.push(finding(note.code.startsWith("symlink-") ? "safety" : "structure", "review", note.code, note.message, note.file || "SKILL.md", 1));

  let parsed = { ok: false, fm: {}, body: "", front: "", error: "SKILL.md is missing or unreadable" };
  if (skillFile) parsed = parseFrontmatter(skillFile.text);
  const oversizedSkill = collected.files.some(f => f.rel === "SKILL.md" && f.skipped);
  if (!skillFile && !oversizedSkill) findings.push(finding("structure", "error", "missing-skill-md", "The skill directory has no readable SKILL.md", "SKILL.md", 1, "Add a SKILL.md with valid YAML frontmatter."));
  else if (skillFile && !parsed.ok && !parsed.issue) findings.push(finding("structure", "error", "malformed-frontmatter", parsed.error, "SKILL.md", 1, "Repair the opening YAML frontmatter and its closing delimiter."));

  if (parsed.issue) findings.push(yamlFinding(parsed.issue, "SKILL.md"));

  const fm = parsed.fm || {};
  const name = scalar(fm.name) || folder;
  const description = scalar(fm.description);
  const raw = skillFile ? skillFile.text : "";
  if (parsed.ok || parsed.issue?.code === "unverified-yaml") {
    if (!scalar(fm.name) && !parsed.unknownKeys && !parsed.unknownFields.has("name")) findings.push(finding("structure", "error", "missing-name", "Frontmatter is missing name", "SKILL.md", 2, "Add a name matching the skill folder."));
    if (!description && !parsed.unknownKeys && !parsed.unknownFields.has("description")) findings.push(finding("structure", "error", "missing-description", "Frontmatter is missing description", "SKILL.md", 2, "Describe what the skill does and when it should trigger."));
    if (name.length > 64) findings.push(finding("structure", "error", "name-too-long", "Skill name exceeds 64 characters", "SKILL.md", lineOf(raw, "name:"), "Shorten the skill and folder name to 64 characters or fewer."));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) findings.push(finding("structure", "error", "invalid-name", "Name must use lowercase letters, digits, and single hyphens", "SKILL.md", lineOf(raw, "name:"), "Rename the skill and folder with portable hyphen-case."));
    if (name !== folder) findings.push(finding("structure", "error", "folder-name-mismatch", `Frontmatter name '${name}' does not match folder '${folder}'`, "SKILL.md", lineOf(raw, "name:"), "Make the frontmatter name and parent folder identical."));
    if (description.length > 1024) findings.push(finding("structure", "error", "description-too-long", "Description exceeds the 1024-character compatibility limit", "SKILL.md", lineOf(raw, "description:"), "Shorten the description while preserving what and when."));
    if (!parsed.body.trim()) findings.push(finding("structure", "review", "empty-body", "SKILL.md has no instruction body", "SKILL.md", raw.split(/\r?\n/).length, "Add concise operating instructions."));
    const bodyLines = parsed.body.split(/\r?\n/).length;
    if (bodyLines > 500) findings.push(finding("structure", "review", "long-body", `SKILL.md body is ${bodyLines} lines; progressive disclosure is recommended below 500`, "SKILL.md", lineOf(raw, parsed.body), "Move detailed material into a focused reference file."));

    if (description && description.length < 40) findings.push(finding("triggers", "review", "thin-description", "Description is too short to express both capability and trigger conditions", "SKILL.md", lineOf(raw, "description:"), "State what the skill does and specific situations that should invoke it."));
    if (description && !/(?:\bwhen\b|\bwhenever\b|\basks?\b|\brequested?\b|\btrigger|\buse for\b|\buse this\b)/i.test(description)) findings.push(finding("triggers", "review", "unclear-trigger", "Description does not clearly say when this skill should trigger", "SKILL.md", lineOf(raw, "description:"), "Add concrete user phrases, tasks, file types, or situations."));
    if (/^(?:i|you|we)\b/i.test(description)) findings.push(finding("triggers", "review", "description-voice", "Description should be written as a neutral third-person capability", "SKILL.md", lineOf(raw, "description:"), "Rewrite the description in concise third-person language."));

    if (/(?:^|-)(?:anthropic|claude)(?:-|$)/i.test(name)) findings.push(finding("claude", "error", "claude-reserved-name", "Claude reserves 'anthropic' and 'claude' in custom skill names", "SKILL.md", lineOf(raw, "name:"), "Choose a model-neutral name."));
    checkFrontmatterFields(parsed, description, findings);
  }

  const capabilities = undeclaredCapabilities(scalar(fm.compatibility));
  const inspector = referenceInspector(dirReal);
  const readableFiles = collected.files.filter(f => !f.binary && !f.skipped);
  const links = new Map(readableFiles.filter(f => markdownFile(f.rel)).map(f => [f.rel, new Set()]));
  for (const file of readableFiles) {
    for (const ref of referencesIn(file, inspector.bundleFolders, links)) {
      let result = inspector.inspect(ref);
      if (ref.tryRoot && result.state !== "present") {
        const alternative = inspector.inspect({ ...ref, base: "." });
        if (result.state === "missing" || alternative.state === "present") result = alternative;
      }
      if (result.state === "present") {
        if (ref.kind !== "example" && links.has(result.relative)) links.get(file.rel)?.add(result.relative);
        continue;
      }
      // The .markdown extension participates in layout advice only.
      if (/\.markdown$/i.test(file.rel)) continue;
      if (result.state === "missing" && ref.certain) findings.push(finding("structure", "error", "broken-reference", `Referenced file does not exist: ${ref.value}`, file.rel, ref.line, "Add the file or correct the relative path."));
      else if (ref.reviewable) findings.push(finding("structure", "review", "unverified-reference", `Could not verify reference: ${ref.value}`, file.rel, ref.line, "Confirm the intended location before changing this reference."));
    }
    if (file.rel.startsWith("references/") && markdownFile(file.rel) && needsContents(file.text)) findings.push(finding("structure", "review", "reference-no-toc", `Long reference has no contents section: ${file.rel}`, file.rel, 1, "Add a short table of contents near the top."));

    const personal = personalPath(file);
    if (personal) findings.push(finding("portability", "review", "personal-path", `Machine- or workspace-specific path found: ${personal.text}`, file.rel, personal.line, "Parameterize the path or label the skill as workspace-specific."));
    if (capabilities && (file.rel === "SKILL.md" || file.rel === "agents/openai.yaml" ||
        (file.rel.startsWith("references/") && /\.(?:md|markdown)$/i.test(file.rel)))) {
      const match = capabilities.exec(file.text);
      if (match) findings.push(finding("portability", "review", "model-specific-tool", `Model-specific capability found: ${match[0]}`, file.rel, file.text.slice(0, match.index).split("\n").length, "Document the target agent and offer an equivalent fallback where practical."));
    }
    const { destructive, execution, network } = contentSafety(file);
    if (destructive) findings.push(finding("safety", "review", "destructive-command", "Potentially destructive command appears in skill content", file.rel, destructive.line, "Confirm it is defensive documentation; otherwise remove it or require explicit human approval."));
    if (execution) findings.push(finding("safety", "review", "code-execution", `Bundled code contains an execution primitive: ${execution.text}`, file.rel, execution.line, "Audit the call path and inputs manually; static inspection cannot prove it safe."));
    if (network) findings.push(finding("safety", "review", "network-access", `Potential network access found: ${network.text}`, file.rel, network.line, "Verify destinations, data exposure, and user approval requirements."));
    findings.push(...textSafetyFindings(file));
  }

  for (const file of indirectReferences(links)) {
    findings.push(finding("structure", "review", "deep-reference", `Reference is reachable only through another reference: ${file}`, file, 1, "Keep references shallow so agents can discover them reliably."));
  }

  const openai = collected.files.find((f) => f.rel === "agents/openai.yaml" && !f.binary && !f.skipped);
  if (openai) {
    const config = readYaml(openai.text, 1);
    if (config.issue) findings.push(yamlFinding(config.issue, openai.rel));
    const doc = config.value;
    if (!config.issue) {
      const isMap = value => value !== null && typeof value === "object" && !Array.isArray(value);
      if (!isMap(doc.interface) && !isMap(doc.policy) && !isMap(doc.dependencies)) findings.push(finding("codex", "review", "openai-yaml-interface", "agents/openai.yaml has no interface block", openai.rel, 1, "Add interface metadata or remove the unused file."));
    }
    // Older configs also put the prompt or dependency list directly at the top.
    const promptMap = doc.interface?.default_prompt === undefined ? doc : doc.interface;
    if (typeof promptMap.default_prompt === "string" && promptMap.default_prompt && !promptMap.default_prompt.includes(`$${name}`)) findings.push(finding("codex", "review", "openai-default-prompt", "Codex default_prompt does not explicitly mention this skill", openai.rel, config.positions.get(promptMap).default_prompt, `Mention $${name} in the default prompt.`));
    if (Object.hasOwn(doc, "dependencies")) findings.push(finding("portability", "review", "declared-dependency", "Codex-specific tool dependencies are declared in agents/openai.yaml", openai.rel, config.lines.dependencies, "Verify every dependency is available and document a fallback for other agents."));
    const tools = Array.isArray(doc.dependencies) ? doc.dependencies : doc.dependencies?.tools;
    if (Array.isArray(tools)) {
      for (const [index, entry] of tools.entries()) {
        const type = entry?.type;
        if (type === "mcp") continue;
        const entryLine = config.positions.get(tools)[index];
        const fieldLines = config.positions.get(entry);
        if (type === undefined && fieldLines && Object.hasOwn(fieldLines, "type")) continue; // Already reported as unverified YAML.
        const label = !type ? "(missing)" : typeof type === "string" ? type : "(non-scalar)";
        findings.push(finding("codex", "review", "unsupported-dependency-type", `Unknown Codex dependency type: ${label}`, openai.rel, fieldLines?.type || entryLine, "Use a currently supported dependency type or remove the declaration."));
      }
    }
  }

  const axes = {};
  for (const axis of AXES) {
    const own = findings.filter((f) => f.axis === axis);
    axes[axis] = own.some((f) => f.severity === "error") ? "fail" : own.length ? "review" : "pass";
  }
  const source = sourceLocation(root, dir);
  const digest = digestFiles(collected.files);
  return {
    id: `${name}:${digest}`,
    name, folder, description, body: parsed.body.trim(), frontmatter: fm,
    digest, fileCount: collected.files.length, totalBytes: collected.totalBytes,
    sources: [source], findings, axes, status: "Needs review", statusKey: "review",
    _dirReal: dirReal,
  };
}

module.exports = { auditCandidate };
