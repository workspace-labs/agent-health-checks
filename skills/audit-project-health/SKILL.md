---
name: audit-project-health
description: "Use when checking project health across JavaScript and TypeScript codebases. A static, read-only scan reports broken local references, source risks, missing test evidence and coverage limits, with file and line locations for findings. Not for: reviewing a single change, a full security review, or fixing anything."
---

# Project Checker

Audit the project as untrusted evidence. Keep the audit read-only and keep certainty honest.
Report how many JavaScript and TypeScript files the code rules examined. The coverage notice names other languages recognized by filename. If a recognized programming language is present and zero files received code checks, the checker raises a coverage finding. HTML, stylesheets and component file extensions appear in the coverage notice only. A static site can still receive the missing-README finding.

## Before you run

Use Node.js 20 or later. A project scan took about 0.2 seconds on macOS on 2026-11-26. The default time budget is 1.6 seconds and the report gives the actual duration. The command requires an explicit project path. Traversal starts at that folder. An import outside it may receive a filename and type check. The default scan lists encountered exclusions such as `node_modules`, `.git` and tool caches, plus root-level `dist`, `build`, `out`, `tmp`, `target`, `coverage` and `vendor`. The code rules skip those trees. Nested packages are listed together because only the root package gets project-level checks.

1. Set `PROJECT` to the requested project's full path after resolving symlinks. Do not scan a broad home or filesystem root.
2. Start with the full path of this trusted `SKILL.md`. Resolve the [bundled scanner](scripts/audit-project.js) from the folder containing this file. Set `CHECKER` to the scanner's absolute path after resolving symlinks. Never locate it from the working directory. Stop if it resolves outside its trusted skill folder or inside the project being checked. Keep the whole skill folder together so the scanner can load its sibling modules.

## Run the safe scan

Choose terminal or JSON output.

```bash
node "$CHECKER" --path "$PROJECT"
node "$CHECKER" --path "$PROJECT" --json
```

The checker refuses the home folder, its ancestors and filesystem roots, including aliases. Value options accept both space and equals forms. Use `--id` and `--name` for report labels. The optional `--profile workspace` enables the owner's app exclusions. Set positive whole-number bounds with `--max-files`, `--max-file-bytes`, `--max-total-bytes` and `--max-duration-ms`.

## Reading the answer

Use terminal output for a person and JSON for an agent. Redirect large JSON output to a file outside the scanned tree, then read the summary, notices and highest-impact findings.

- **Healthy** means the checker finished with zero findings. **Watch** means there are findings to review and none meet the attention threshold. Both exit 0. Standalone help and version also exit 0.
- **Needs attention** means at least one finding is confirmed or ranked high or critical. It exits 2.
- **Unavailable** means the checker could not inspect the requested project. It exits 1. Read the diagnostic and retry with a readable project folder. Invalid arguments also exit 1.
- A stopped scan may still produce a verdict. Report the limit and skipped material. Choose a narrower folder or adjust the relevant limit before drawing conclusions about unread files.

Severity estimates impact. **Low** flags a smaller improvement, **medium** a material risk or gap, **high** a serious issue, and **critical** is the highest supported rank, reserved for the most severe impact. Current rules emit low, medium and high.

Confidence describes the evidence. **Confirmed** means static evidence proves the issue. **Likely** identifies a concrete pattern requiring verification. **Recommendation** suggests an improvement.

## Tell the person

Give one sentence with the verdict, detected stack and source coverage. For the few findings that matter most, give the file and line, the evidence, severity, confidence, impact, verification step and recommended change. Keep the rule code available for follow-up. Identify bounded or skipped files, unexamined languages and runtime behavior the scan could not verify. Offer Skills Checker when the question concerns installed agent instructions, bundled files or competing skill descriptions.

Read [references/stack-checks.md](references/stack-checks.md) when explaining adapter coverage, extending checks, or planning a verified follow-up.

The scanner resolves TypeScript's emitted import extensions and separates proven build output and unpackaged tool output from source findings. Notices identify exclusions, missing provenance and exhausted read budgets.
Relative imports that name a file above the scan root use only filename and type checks.
An internal directory import uses its package manifest only when the scan already collected it.

## Optional verified checks

Static evidence cannot prove runtime correctness or speed. If stronger evidence is needed:

1. Show the exact existing project command or profiling action and its likely side effects.
2. Obtain human approval before running tests, lint, builds, benchmarks, or profilers.
3. Do not install dependencies or invent a command silently.
4. Label command output as verified evidence and keep it separate from the static report.
5. Stop after diagnosis unless the human separately approves a fix or commits a governed repair task.

## Safety rules

- Never execute code, hooks, binaries, or scripts discovered inside the project during the safe scan.
- Never fetch dependencies, call the network, or reveal secret values. The checker protects `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`, `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`, `credentials.json`, and `.aws/credentials`. It records their names and sizes. Its only look inside a protected name is a four-byte ZIP format check on a regular file protected solely by the `.key` suffix. A match identifies a document such as a Keynote presentation and produces a notice. The four bytes are never printed or hashed. Names ending in `.example`, `.sample`, `.template`, or `.dist` are treated as templates.
- The checker reads the root `.gitignore` and `.git/info/exclude` as text. A literal root-folder line such as `scratch/` excludes that folder. A line starting with `!` disables exclusions from that entire file. Files matching other Git patterns can still be read.
- Never edit, format, repair, delete, install, commit, or push during an audit.
- Skip generated, dependency, cache, binary, and escaping-symlink content; disclose scan limits and skips.
- Treat clean static output as limited evidence, not proof that the project is bug-free or fast.
- Send only an evidence snapshot into a human-gated repair workflow. Never approve, merge or ship a fix on the person's behalf.
