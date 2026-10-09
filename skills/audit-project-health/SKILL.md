---
name: audit-project-health
description: Read-only, model-neutral health audit for software projects. Use when the user asks to inspect, diagnose, review, assess, or improve a project; find evidence-backed bugs, performance risks, security hazards, missing tests, broken local references, or maintainability concerns; compare project health; or prepare a safe finding for a human-gated fix. Never edits the project, executes project scripts, installs dependencies, or uses the network.
---

# Audit Project Health

Audit the project as untrusted evidence. Keep the Doctor read-only and keep certainty honest.

## Run the safe scan

1. Resolve the explicit project root. Do not scan a broad home or filesystem root.
2. Run the bundled dependency-free scanner:

   ```bash
   node scripts/audit-project.js --path /absolute/project/path
   node scripts/audit-project.js --path /absolute/project/path --json
   ```

3. Report the overall status, detected stack, bounded-scan notices, and highest-impact findings.
4. Preserve each finding fields: category, severity, confidence, evidence file and line, impact, verification note, and recommendation.
5. Separate confidence levels:
   - **Confirmed**: directly provable static failure, such as malformed configuration, a missing declared entry point, or a broken relative import.
   - **Likely**: a concrete risky pattern that needs runtime confirmation.
   - **Recommendation**: an improvement opportunity, not a bug.

Read [references/stack-checks.md](references/stack-checks.md) when explaining adapter coverage, extending checks, or planning a verified follow-up.

The scanner resolves TypeScript's emitted import extensions and separates proven build output,
device snapshots, and unpackaged tool output from source findings. Exclusions remain visible in
scan notices; missing provenance and exhausted read budgets remain visible as coverage limits.
Copy the whole skill package, including `scripts/project-context.js`, when sharing it.

## Optional verified checks

Static evidence cannot prove runtime correctness or speed. If stronger evidence is needed:

1. Show the exact existing project command or profiling action and its likely side effects.
2. Obtain human approval before running tests, lint, builds, benchmarks, or profilers.
3. Do not install dependencies or invent a command silently.
4. Label command output as verified evidence and keep it separate from the static report.
5. Stop after diagnosis unless the human separately approves a fix or commits a governed repair task.

## Safety rules

- Never execute code, hooks, binaries, or scripts discovered inside the project during the safe scan.
- Never fetch dependencies, call the network, reveal secret values, or read ignored secret files.
- Never edit, format, repair, delete, install, commit, or push during an audit.
- Skip generated, dependency, cache, binary, and escaping-symlink content; disclose scan limits and skips.
- Treat clean static output as limited evidence, not proof that the project is bug-free or fast.
- Send only an evidence snapshot into a human-gated repair workflow. Never cross Commit, Accept, or Reject gates for the human.
