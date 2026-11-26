#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { comparePath, normalizeRoots, inside, sourceLocation } = require("./skill-paths");
const { AXES, finding, finalizeStatus } = require("./skill-findings");
const { parseFrontmatter } = require("./skill-yaml");
const { overlapScore, closestDescriptions, descriptionCharacters } = require("./skill-descriptions");
const { auditCandidate } = require("./skill-candidate");
const { inspectRoot, hasGuide, discoveryDirectory, discoverInstalls, uncheckedLocations, refusedLink } = require("./skill-discovery");
const { parseCli, compactSkill, terminalText, printHuman } = require("./skill-report");
const { addLookAlikes } = require("./skill-look-alike");

const CHECKER_VERSION = "0.13.0";
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 320, maxFileBytes: 1024 * 1024, maxTotalBytes: 6 * 1024 * 1024 });

function mergeInstallations(copies) {
  // Stable representative and finding order, even when the caller reverses its roots.
  copies.sort((a, b) => comparePath(a._dirReal, b._dirReal));
  const first = copies[0];
  if (copies.length === 1) return first;
  const seen = new Set();
  const findings = [];
  const sources = [];
  const axes = { ...first.axes };
  for (const copy of copies) {
    sources.push(...copy.sources);
    for (const item of copy.findings) {
      const identity = JSON.stringify(item);
      if (!seen.has(identity)) {
        seen.add(identity);
        findings.push(item);
      }
    }
    for (const axis of AXES) {
      if (copy.axes[axis] === "fail" || axes[axis] === "pass") axes[axis] = copy.axes[axis];
    }
  }
  return { ...first, sources, findings, axes };
}

function auditSkillRoots(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const contexts = normalizeRoots(options.roots).map(inspectRoot);
  const readable = contexts.filter(context => context.report.state === "read");
  const candidates = [];
  const links = [];
  const physical = new Map();
  const sourceOrder = new Map();
  const statusRank = { broken: 0, review: 1, workspace: 2, claude: 3, codex: 3, universal: 4 };
  const worstCopy = new Map();

  function add(context, dir, dirReal, discoveryDepth) {
    const skill = auditCandidate({ root: context.root, rootReal: context.real, dir, dirReal, folder: path.basename(dir), discoveryDepth }, limits);
    context.locations.add(dirReal);
    context.report.skills++;
    sourceOrder.set(skill.sources[0], context);
    candidates.push(skill);
    if (discoveryDepth === undefined) physical.set(dirReal, skill);
    return skill;
  }

  for (const context of readable) {
    context.locations = new Set();
    discoverInstalls(context, add, links);
  }
  for (const { context, dir } of links) {
    let real, errorCode;
    try { real = fs.realpathSync(dir); } catch (error) { errorCode = error.code || "unresolved"; }
    const owners = real ? readable.filter(owner => inside(owner.real, real)) : [];
    if (errorCode || !owners.length) {
      const skill = refusedLink(context, dir, real, errorCode);
      sourceOrder.set(skill.sources[0], context);
      candidates.push(skill);
      context.report.skills++;
      continue;
    }
    let skill = physical.get(real);
    if (!skill) {
      // A top-level link can explicitly install a skill deeper than automatic discovery.
      // Overlapping scan roots own explicit targets from the nearest root outward.
      owners.sort((a, b) => b.real.length - a.real.length || comparePath(a.root.path, b.root.path)
        || comparePath(a.root.id, b.root.id) || comparePath(a.root.label, b.root.label));
      const owner = owners.find(item => path.relative(item.real, real).split(path.sep).every(discoveryDirectory));
      if (!owner) continue;
      let entries;
      try { entries = fs.readdirSync(real, { withFileTypes: true }); } catch { continue; }
      if (!hasGuide(entries)) continue;
      const target = path.join(owner.root.path, path.relative(owner.real, real));
      skill = add(owner, target, real);
    }
    const source = { ...sourceLocation(context.root, dir), isLink: true };
    sourceOrder.set(source, context);
    skill.sources.push(source);
    context.report.skills++;
  }

  const groups = new Map();
  for (const skill of candidates) {
    if (!groups.has(skill.id)) groups.set(skill.id, []);
    groups.get(skill.id).push(skill);
  }
  const unique = [], byName = new Map();
  let mirrors = 0;
  for (const copies of groups.values()) {
    const skill = mergeInstallations(copies);
    unique.push(skill);
    if (!skill._dirReal) continue; // Unread refusals are not content or name conflicts.
    const installsByRoot = new Map();
    for (const copy of copies) {
      const root = sourceOrder.get(copy.sources[0]).real;
      if (!installsByRoot.has(root)) installsByRoot.set(root, new Set());
      installsByRoot.get(root).add(copy._dirReal);
      if (copies.length > 1) {
        const { status, statusKey } = finalizeStatus({ ...copy, findings: [...copy.findings] });
        if (!worstCopy.has(skill) || statusRank[statusKey] < statusRank[worstCopy.get(skill).statusKey]) {
          worstCopy.set(skill, { status, statusKey });
        }
      }
    }
    const multiplicity = Math.max(...Array.from(installsByRoot.values(), paths => paths.size));
    mirrors += new Set(copies.map(copy => copy._dirReal)).size - multiplicity;
    const group = byName.get(skill.name) || { cards: [], count: 0 };
    group.cards.push(skill);
    group.count += multiplicity;
    byName.set(skill.name, group);
    skill.sources.sort((a, b) => contexts.indexOf(sourceOrder.get(a)) - contexts.indexOf(sourceOrder.get(b)) || comparePath(a.path, b.path));
  }
  for (const [name, { cards, count }] of byName) if (count > 1) for (const skill of cards) {
    skill.findings.push(finding("portability", "review", "duplicate-name", `${count} different skills share the name '${name}'`, "SKILL.md", 1, "Rename or consolidate the conflicting implementations."));
    skill.axes.portability = "review";
  }
  addLookAlikes(byName);
  for (const skill of unique) {
    finalizeStatus(skill);
    const worst = worstCopy.get(skill);
    if (worst && statusRank[worst.statusKey] < statusRank[skill.statusKey]) Object.assign(skill, worst);
  }
  unique.sort((a, b) => (statusRank[a.statusKey] - statusRank[b.statusKey]) || comparePath(a.name, b.name) || comparePath(a.digest, b.digest));
  const statuses = { universal: 0, claude: 0, codex: 0, workspace: 0, review: 0, broken: 0 };
  unique.forEach(skill => { statuses[skill.statusKey]++; });
  const summary = { skills: unique.length, mirrors, findings: unique.reduce((n, s) => n + s.findings.length, 0), statuses };
  summary.closestPairs = closestDescriptions(unique);
  const characters = descriptionCharacters(unique, contexts);
  if (characters) summary.descriptionCharacters = characters;
  return {
    schemaVersion: 1,
    checkerVersion: CHECKER_VERSION,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    disclaimer: "Static contract evidence only — no scripts executed, no network used, and no runtime behavior guaranteed.",
    roots: contexts.map(context => context.report),
    ...(!options.roots?.length ? { coverage: uncheckedLocations(contexts) } : {}),
    summary,
    skills: unique,
  };
}

if (require.main === module) {
  const exitTwoCodes = new Set([
    "destructive-command", "code-execution", "network-access", "download-and-run",
    "hidden-characters", "credential-access", "decode-and-run", "safeguard-off",
    "load-time-command", "frontmatter-hooks", "unrestricted-shell-grant",
  ]);
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.version) {
      console.log(CHECKER_VERSION);
      process.exit(0);
    }
    if (cli.help) {
      console.log("Usage: node scripts/audit-skills.js [--json [--include-body]] [--root label=/absolute/path]...");
      console.log("Exit 0: completed without Broken skills or open exit-2 safety findings. Help and version also exit 0.");
      console.log("Exit 2: a Broken skill or an open safety finding with one of these codes: " + [...exitTwoCodes].join(", ") + ".");
      console.log("Exit 1: unavailable explicit root, zero skills across explicit roots, invalid usage or checker failure.");
      process.exit(0);
    }
    const report = auditSkillRoots({ roots: cli.roots });
    if (cli.json) {
      const output = cli.includeBody ? report : { ...report, skills: report.skills.map(compactSkill) };
      process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    } else printHuman(report, cli.roots.length > 0);
    const rootError = cli.roots.length > 0 && (report.summary.skills === 0 || report.roots.some(root => root.state !== "read"));
    const needsAttention = report.summary.statuses.broken || report.skills.some(skill => skill.findings.some(f => exitTwoCodes.has(f.code)));
    process.exitCode = rootError ? 1 : needsAttention ? 2 : 0;
  } catch (error) {
    console.error(terminalText(`Skills Checker failed: ${error.message}`));
    process.exitCode = 1;
  }
}

module.exports = { AXES, DEFAULT_LIMITS, auditSkillRoots, parseFrontmatter, overlapScore };
