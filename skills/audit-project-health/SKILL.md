---
name: audit-project-health
description: Read-only, model-neutral health audit for JavaScript and TypeScript projects. Use when the user asks to inspect, diagnose, review, assess, or improve a project; find evidence-backed bugs, performance risks, security hazards, missing tests, broken local references, or maintainability concerns; compare project health; or prepare a safe finding for a human-gated fix. Never edits the project, executes project scripts, installs dependencies, or uses the network.
---

# Audit Project Health

Audit the project as untrusted evidence. Keep the Doctor read-only and keep certainty honest.
Report how many JavaScript and TypeScript files the code rules examined. The coverage notice names other languages recognized by filename. If a recognized programming language is present and zero files received code checks, the checker raises a coverage finding. HTML, stylesheets and component file extensions appear in the coverage notice only. A static site can still receive the missing-README finding.

## Run the safe scan

1. Set `PROJECT` to the requested project's full path after resolving symlinks. Do not scan a broad home or filesystem root.
2. Start with the full path of this trusted `SKILL.md`. Resolve the [bundled scanner](scripts/audit-project.js) from the folder containing this file. Set `CHECKER` to the scanner's absolute path after resolving symlinks. Never locate it from the working directory. Stop if it resolves outside its trusted skill folder or inside the project being checked. Choose the terminal or JSON report.

   ```bash
   node "$CHECKER" --path "$PROJECT"
   node "$CHECKER" --path "$PROJECT" --json
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
Relative imports that name a file above the scan root use only filename and type checks.
An internal directory import uses its package manifest only when the scan already collected it.
Copy the whole skill package, including every file in `scripts/`, when sharing it.

## Optional verified checks

Static evidence cannot prove runtime correctness or speed. If stronger evidence is needed:

1. Show the exact existing project command or profiling action and its likely side effects.
2. Obtain human approval before running tests, lint, builds, benchmarks, or profilers.
3. Do not install dependencies or invent a command silently.
4. Label command output as verified evidence and keep it separate from the static report.
5. Stop after diagnosis unless the human separately approves a fix or commits a governed repair task.

## Safety rules

- Never execute code, hooks, binaries, or scripts discovered inside the project during the safe scan.
- Never fetch dependencies, call the network, or reveal secret values. The checker protects `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`, `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`, `credentials.json`, and `.aws/credentials`. It records their names and sizes without opening them. Names ending in `.example`, `.sample`, `.template`, or `.dist` are treated as templates.
- The checker reads the root `.gitignore` and `.git/info/exclude` as text. A literal root-folder line such as `scratch/` excludes that folder. A line starting with `!` disables exclusions from that entire file. Files matching other Git patterns can still be read.
- Never edit, format, repair, delete, install, commit, or push during an audit.
- Skip generated, dependency, cache, binary, and escaping-symlink content; disclose scan limits and skips.
- Treat clean static output as limited evidence, not proof that the project is bug-free or fast.
- Send only an evidence snapshot into a human-gated repair workflow. Never cross Commit, Accept, or Reject gates for the human.
