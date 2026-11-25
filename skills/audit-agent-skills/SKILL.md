---
name: audit-agent-skills
description: Read-only health audit for installed Agent Skills across Claude and Codex. Use when the user asks to inspect, validate, review, troubleshoot, compare, or inventory AI skills; check SKILL.md structure, trigger descriptions, safety signals, portability, references, duplicate names, likely trigger conflicts, or Claude/Codex compatibility; or wants a deterministic report before sharing or installing a skill. Never changes skills and never executes bundled scripts.
---

# Audit Agent Skills

Audit skill folders as evidence, not as trusted code. Keep the operation read-only.

## Run the audit

1. Start with the full path of this trusted `SKILL.md`. Resolve the [bundled scanner](scripts/audit-skills.js) from the folder containing this file. Set `CHECKER` to the scanner's absolute path after resolving symlinks. Never locate it from the working directory.
2. Stop if the scanner resolves outside its trusted skill folder. Run this installed copy even when its own folder is among the skills being checked. The default scan reads skills in `~/.claude/skills`, `~/.codex/skills`, and `~/.agents/skills`.
3. Run the default scan for a terminal report.

   ```bash
   node "$CHECKER"
   ```

4. For a JSON report, run

   ```bash
   node "$CHECKER" --json
   ```

5. For an explicit collection or a single skill, set `COLLECTION` to its full path. Repeat `--root` with a separate label and path for each additional collection.

   ```bash
   node "$CHECKER" --root "collection=$COLLECTION" --json
   ```

6. Check the root states and any entries marked “not searched” at the start of the terminal report. Exit 1 means an explicit root or argument needs attention. Exit 2 means at least one skill is Broken. Report the summary, then the highest-impact evidence. Separate hard structural failures from heuristic review warnings. Include file and line locations when present.

## Interpret results

- **Universal**: shared contract and both compatibility profiles pass with no review findings.
- **Claude-ready / Codex-ready**: one profile passes while the other has model-specific evidence to review.
- **Workspace-specific**: valid but tied to personal paths, local governance, or a particular machine.
- **Needs review**: no shared-contract break, but heuristics found ambiguity, risk, conflict, or portability concerns.
- **Broken**: a hard shared-contract failure such as missing or malformed `SKILL.md`, invalid naming, or a broken bundled reference.

Treat every result as static evidence. A clean report does not prove runtime safety or guarantee behavior in every agent.

## Safety rules

- Never execute files discovered as evidence during the scan.
- Never fetch dependencies or follow external links during the audit.
- Never edit, repair, normalize, or install a skill unless the user separately approves that work.
- Count a linked install as a source when its target is a skill inside a scanned root. Report the target of an escaping install link as unchecked.
- Keep size and file-count limits enabled. Include unread file counts when describing a partial scan.

Read [references/compatibility.md](references/compatibility.md) when explaining profile differences or adjusting checks for a newer Agent Skills revision.
