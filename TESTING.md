# Testing

How these two checkers were tested, how often, and what was never tested.
Every number below comes from a run that actually happened. Nothing is rounded up.

## Run the tests yourself

```bash
node --test
```

Run from the repository root. The suite uses Node’s built-in test runner and creates its fixtures in the system temporary directory. See the dated runs below for the exact versions tested.

## Step 8 Part 2 · 0.13.0 · 2026-11-26

The clean `v0.12.0` baseline at `c77025d` passed 800 tests on macOS. Each new rule first failed against that baseline with its positive fixture. The info severity and the revised exit-code list also failed their new contract tests before implementation.

On Apple silicon macOS, `node --test --test-concurrency=2 --test-reporter=tap` passed **873 of 873 tests** on each of Node **20.20.2**, **22.23.1**, **24.22.1** and **26.13.1**. Each run recorded zero failures, skips and cancellations and left its isolated home and temporary directory empty.

### Supplied fixture comparison

Both CLIs inspected identical copies of the TH4, TH5, TH7, TH9 and TH10 fixtures with a temporary home. The table counts fixture directories. Every affected skill in a triggering fixture produced exactly the expected new codes. Every control was clear of all seven codes. All 13 earlier finding objects in the supplied scripts matched in order, including messages, lines and suggestions.

| Group | Triggering fixtures | Harmless controls | Observed result |
|---|---:|---:|---|
| TH4 | 4 / 4 | 4 / 4 | Both inline and fenced load commands were reported. The combined Bash fixture also received the broad-grant finding. |
| TH5 | 6 / 6 | 5 / 5 | Three hook events, two broad grants and one hidden menu entry were reported with their earlier portability findings. |
| TH7 | 3 / 3 | 5 / 5 | The checker found single-line, multiline and reference-file comments. |
| TH9 | 5 / 5 | 4 / 4 | Each triggering skill had one info finding, all axes passed, the verdict was Universal and the CLI exited 0. |
| TH10 | 4 / 4 | 3 / 3 | Both members of each pair received the finding. The script's separate non-Latin example also flagged both names and retained its original invalid-name error. |

### Tests added or updated

| File under `tests/` | What it checks |
|---|---|
| `skill-cli-output.test.js` | Verifies the new exit-2 codes in help and isolates each new safety code in the CLI. Checks NOTE, review and info counts, all six axes and exit 0 for a standing-file note. |
| `skill-report-contract.test.js` | Exercises all three JSON severities alongside all six verdicts and checks each count against its findings. |
| `skill-safety-markdown.test.js` | Tests load commands, comment counts and source lines, multiline excerpts, pragmas, code spans and fences, quoted and list examples, and resuming after a fence. |
| `skill-frontmatter-powers.test.js` | Tests event names, shell grant formats and scopes, hidden menu declarations, YAML field boundaries and existing portability findings. |
| `skill-standing-file.test.js` | Covers the listed write actions and targets, the 100-character limit, first evidence, look-alike filenames and read-only instructions. |
| `skill-look-alike.test.js` | Checks edits and character folds, both members of each pair, deterministic evidence with multiple neighbours, duplicates, minimum length and exit 0. |

### Read-only default toolbox comparison

Both releases saw 80 unique skills and 56 identical mirrors. Both reported 38 Universal, 42 Needs review and zero in the other four categories, and both exited 2. Findings rose from 216 to 223. The 216 earlier findings matched field for field in their original order for every skill. Four skills gained standing-file notes, two gained hidden-comment findings and one gained a broad shell grant. The scan found zero look-alike pairs, load commands, frontmatter hooks or hidden menu entries.

| Skill | File | Line | New code | Evidence |
|---|---|---:|---|---|
| `constraint-driven-development` | `SKILL.md` | 140 | `standing-file-write` | `AGENTS.md` |
| `deep-research-pro` | `templates/report_template.md` | 3 | `hidden-comment` | 46 hidden comment(s), first excerpt `============================================================` |
| `hidden-prompt-library` | `library/code/prompts.json` | 180 | `standing-file-write` | `.claude/settings.json` |
| `mcp-builder` | `SKILL.md` | 76 | `standing-file-write` | `.mcp.json` |
| `project-docs` | `references/plan.md` | 296 | `standing-file-write` | `CLAUDE.md` |
| `security-review` | `SKILL.md` | 4 | `unrestricted-shell-grant` | `Bash` |
| `security-review` | `SKILL.md` | 8 | `hidden-comment` | 1 hidden comment(s), first excerpt `Reference material based on OWASP Cheat Sheet Series (CC BY-` |

## Step 8 Part 1 · Fix round 1 · 0.12.0 · 2026-11-26

The baseline at `d2f54a9` passed its 783 tests on Node 20.20.2. Before the fixes, each of the seven review examples missed its expected finding. On the corrected code, **800 of 800 tests passed** on each of Node **20.20.2, 22.23.1, 24.22.1 and 26.13.1** on Apple silicon macOS. The command was `node --test --test-concurrency=2 --test-reporter=tap`. All four runs finished with zero failures, cancellations or skips and empty temporary home and scratch directories.

| Review row | Input checked as text | Observed finding |
|---|---|---|
| F1 | A black flag encloses 30 tag letters and a cancel tag | `hidden-characters` counts 31 on line 1 |
| F2a | A download is piped to `/bin/bash` | `download-and-run` |
| F2b | A download is piped to `/usr/bin/env bash` | `download-and-run` |
| F2c | A base64 decode is piped to `/bin/sh` | `decode-and-run` |
| F3a | A parenthesized `irm` download is passed to `iex` | `download-and-run` |
| F3b | A nested `DownloadString` call is passed to `iex` | `download-and-run` |
| F3c | `Invoke-Expression` uses the content of a parenthesized `Invoke-WebRequest` | `download-and-run` |

All 13 control checks stayed quiet. These covered the England, Scotland and Wales flags, three ordinary pipe destinations tested with both pipeline rules, local PowerShell expressions, JSON conversion and a download that only saves a file. The original 53 Part 1 examples also retained their expected findings.

The read-only default toolbox scan reported **80 unique skills, 56 identical mirrors, 38 Universal, 42 Needs review and 216 findings**. All four other status counts were zero. Both terminal and JSON runs exited 2. Excluding the timestamp, the full JSON report matched the one from `d2f54a9`, including the same three Part 1 findings in `security-review`.

### GitHub Actions for 0.12.0

All nine jobs passed on commit `3b80b47`. Each cell shows **passed / skipped** out of 800 tests. All 17 fix-round tests passed in every job. [GitHub Actions run 45853288604](https://github.com/workspace-labs/agent-health-checks/actions/runs/45853288604)

| System | Node 20 | Node 22 | Node 24 |
|---|---:|---:|---:|
| macOS | 800 / 0 | 800 / 0 | 800 / 0 |
| Ubuntu Linux | 799 / 1 | 799 / 1 | 799 / 1 |
| Windows | 782 / 18 | 782 / 18 | 782 / 18 |

Ubuntu skipped the alternate-home-spelling check because the runner uses a case-sensitive filesystem. Windows skipped the same 18 symbolic-link tests listed under 0.11.0. Each Windows job also verified the README PowerShell installation and the second-install overwrite refusal. [Ubuntu job](https://github.com/workspace-labs/agent-health-checks/actions/runs/45853288604/job/140024972954) · [Windows job](https://github.com/workspace-labs/agent-health-checks/actions/runs/45853288604/job/140024972841) · [Detailed skip list](#github-actions-for-0110)

## Step 8 Part 1 · 0.12.0 · 2026-11-26

On Apple silicon macOS, `node --test --test-concurrency=2 --test-reporter=tap` passed **783 of 783 tests** on each of Node **20.20.2, 22.23.1, 24.22.1 and 26.13.1**. There were zero failures, cancellations or skips. Each run finished with its temporary home and temporary-file directory empty.

The new tests ran first against v0.11.0 at `423da76`. Each new code failed its isolated CLI test. The supplied examples were then scanned with both versions. All 31 triggering examples gained exactly their expected code, and all 22 controls were clear of the five new codes. For every example, the ordered list of earlier findings matched field for field, including file, line, message and suggestion.

| Finding | Triggering examples detected | Harmless controls clear |
|---|---:|---:|
| `download-and-run` | 7 / 7 | 4 / 4 |
| `hidden-characters` | 6 / 6 | 5 / 5 |
| `credential-access` | 6 / 6 | 5 / 5 |
| `decode-and-run` | 6 / 6 | 4 / 4 |
| `safeguard-off` | 6 / 6 | 4 / 4 |

An instrumented disposable copy captured finalized skill findings across all 383 Skills Checker tests. It emitted all 50 distinct codes in the inventory below.

### Tests changed

| File under `tests/` | What it proves |
|---|---|
| `skill-safety-pipelines.test.js` | Downloads and decodes must lead to execution on the same line. Covers prose, scripts, references, labelled and unlabelled fences, legacy findings, and controls that only download, decode or print text. |
| `skill-safety-unicode.test.js` | Checks the first affected line and the total by Unicode code point. Controls include Arabic and Persian writing, a flag, family emoji, individual variation selectors and the initial BOM. |
| `skill-safety-settings.test.js` | Checks the named credential stores, commands and safeguard settings. Public keys, environment setup advice, unrelated options and ordinary secure downloads serve as controls. |
| `skill-safety-text.test.js` | Checks the 80-character evidence limit, first finding per rule per file, messages, suggestions and escaped invisible evidence in a quoted command. |
| `skill-cli-output.test.js` | Each new code independently produces exit 2, appears in help and leaves the clean control at exit 0. The human report escapes control characters in command evidence. |
| `skill-collection.test.js` | The download-to-shell fixture under each of four bundled directories gains the fourth finding alongside the three existing ones. |
| `support/safety-text.js` | Runs the published CLI against temporary fixtures with an isolated home and removes the fixtures after each test. |

### Read-only default toolbox scan

Both runs saw the same 80 skill identities and 56 identical mirrors. Both reported 38 Universal and 42 Needs review, zero in all other status categories, and exit 2. Findings went from 213 to 216. All 213 earlier findings matched exactly. The three additions came from examples in `security-review`.

| New code | File in the skill | Line | Evidence |
|---|---|---:|---|
| `credential-access` | `infrastructure/docker.md` | 375 | The Docker login configuration path |
| `decode-and-run` | `references/supply-chain.md` | 235 | Python passes a base64 decode to exec |
| `download-and-run` | `references/supply-chain.md` | 258 | A curl download goes directly to Bash |

## Step 7 Part 3 · 0.11.0 · 2026-11-26

On macOS, `node --test --test-reporter=tap` passed **690 tests** on each of Node **20.20.2, 22.23.1, 24.22.1 and 26.13.1**, with zero failures, cancellations or skips. Every run had its own temporary home and temporary-file directory. Both directories were empty after each run.

### Regressions and controls

The release baseline was `v0.10.0` at `41cceb5`. The new regression fixtures exposed the missing behavior before implementation. The final CLI rerun confirmed the following results.

| Test file under `tests/` | What changed and why |
|---|---|
| `skill-coverage-and-pairs.test.js` | The existing ranking case now expects only the one positive pair. A new case checks unrelated descriptions in both JSON and terminal output. |
| `skill-report-contract.test.js` | The existing single-skill summary now explicitly includes an empty `closestPairs` array. |
| `skill-layout-and-noise.test.js` | A new case checks direct filenames in prose and backticks, at the root and under a bundled folder, with an indirect-only link, a missing example and near-matching names as controls. |
| `project-source-rules.test.js` | Five cases cover the two `.call` forms, the grouped global reference, the literal template key and the alias assignment. A sixth covers the same assignment with an implicit semicolon. Unrelated receivers, comments, strings, template text, an object key, a comparison and longer names stay quiet. |
| `project-files-and-order.test.js` | The protected-file access test now permits exactly one format probe on its eligible key. Four new cases cover a large ZIP-signed document, a Keynote folder and PEM control, the exact byte range and content-independent digest, and short, near-match and unreadable keys. A name also protected by the environment-file rule stays unopened. |
| `skill-yaml.test.js` | Four decoding cases cover wrapped double and single quotes, blank lines and an escaped line break. Two CLI cases pin the Broken verdict and exit 2 for unclosed quotes. Two agent-config controls preserve the prior review finding in `agents/openai.yaml`. |

### Read-only toolbox comparison

During the work, the default inventory went from 81 to 80 unique skills as the synced `underwater-acoustics` entry disappeared. The initial 0.10.0 scan saw 216 findings and one Broken skill. To compare releases against the same files, both checkers below ran back to back from the same working directory against the same 80 skill identities.

| Skills Checker | Unique skills | Identical mirrors | Universal | Needs review | Broken | Findings | Exit |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0.10.0 | 80 | 56 | 38 | 42 | 0 | 214 | 2 |
| 0.11.0 | 80 | 56 | 38 | 42 | 0 | 213 | 2 |

The other three status counts were zero in both reports. No skill changed status. The only finding removed was `deep-reference` on `hidden-prompt-library/DROPPED.md`, which the guide names directly.

### GitHub Actions for 0.11.0

All nine jobs passed on commit `9d98ecb`. Each cell shows **passed / skipped** out of 690 tests. Every job had zero failures. [GitHub Actions run 45760847132](https://github.com/workspace-labs/agent-health-checks/actions/runs/45760847132)

| System | Node 20 | Node 22 | Node 24 |
|---|---:|---:|---:|
| macOS | 690 / 0 | 690 / 0 | 690 / 0 |
| Ubuntu Linux | 689 / 1 | 689 / 1 | 689 / 1 |
| Windows | 672 / 18 | 672 / 18 | 672 / 18 |

The skip lists matched 0.10.0 on all three Node versions. Each Ubuntu job skipped `the refusal recognizes alternate home spelling on case-insensitive volumes` because its filesystem is case-sensitive. The test passed on macOS and Windows. [Ubuntu job log](https://github.com/workspace-labs/agent-health-checks/actions/runs/45760847132/job/139710212014)

<details>
<summary>18 symbolic-link tests skipped on each Windows runner and passed on macOS and Ubuntu</summary>

| Test file under `tests/` | Test skipped on Windows |
|---|---|
| `project-coverage.test.js` | a symlinked info directory cannot supply ignore rules |
| `project-doctor-context.test.js` | ordinary in-project links stay visible without duplicating findings from their target |
| `project-doctor-reading.test.js` | TypeScript substitution refuses a matching source symlink escaping the project |
| `project-doctor-reading.test.js` | tablet symlinked metadata cannot exclude the snapshot |
| `project-doctor.test.js` | scan bounds and escaping symlinks remain visible |
| `project-doctor.test.js` | broken project symlinks are disclosed with a safe resolution code |
| `project-entry-checks.test.js` | links to external files and output directories cannot confirm missing main or bin |
| `project-import-resolution.test.js` | imports resolve internal file and directory links and refuse links crossing the project boundary |
| `project-import-resolution.test.js` | absolute internal links resolve through the spelling used to open the project |
| `project-import-resolution.test.js` | repeated metadata checks read a link only once per audit |
| `project-import-resolution.test.js` | a sibling link cannot prove an external import is missing |
| `project-report-noise.test.js` | 3000 broken links respect the file bound and fit in one ten-example notice |
| `project-report-noise.test.js` | a lone broken link keeps its path and reason and a valid internal link stays a distinct notice |
| `skill-doctor.test.js` | symlinks escaping a declared root are refused |
| `skill-doctor.test.js` | broken skill symlinks are explicit safety findings |
| `skill-doctor.test.js` | refused root symlinks still carry a stable, unique audit digest |
| `skill-references.test.js` | a reference passing through an external link cannot confirm presence or absence |
| `skill-references.test.js` | an internal link can resolve within the skill and normalized spellings on one line yield one finding |

</details>

The README PowerShell installation step passed on all three Windows runners. Each ran the published commands in a temporary home, verified both installed guides and checker scripts, then confirmed that a second run refused to overwrite either copy. [Windows Node 20](https://github.com/workspace-labs/agent-health-checks/actions/runs/45760847132/job/139710211870) · [Windows Node 22](https://github.com/workspace-labs/agent-health-checks/actions/runs/45760847132/job/139710211949) · [Windows Node 24](https://github.com/workspace-labs/agent-health-checks/actions/runs/45760847132/job/139710211972)

## Step 7 Part 1 · 0.10.0 · 2026-11-26

### Local test matrix

From the repository root, run `node --test`. These macOS runs used a temporary home and `--test-reporter=tap` to record the counts. Each row includes the two real CLI permission tests.

| Node | Passed | Failed | Skipped | Permission flags used by each CLI test |
|---|---:|---:|---:|---|
| 20.20.2 | 670 | 0 | 0 | `--experimental-permission --allow-fs-read=*` |
| 22.23.1 | 670 | 0 | 0 | `--permission --allow-fs-read=*` |
| 24.22.1 | 670 | 0 | 0 | `--permission --allow-fs-read=*` |
| 26.13.1 | 670 | 0 | 0 | `--permission --allow-fs-read=*` |

The v0.9.0 suite passed 649 tests and left 15 fixture directories in an initially empty temporary directory. On 0.10.0 the actual system temp directory contained 34,322 entries before and after the final Node 20 run, with zero names added or removed. Each of the other three full runs used a fresh temporary directory and left it empty.

### GitHub Actions for 0.10.0

All nine jobs passed on commit `f6970a7`. Each cell shows **passed / skipped** out of 670 tests. Every job had zero failures. [GitHub Actions run 45754206834](https://github.com/workspace-labs/agent-health-checks/actions/runs/45754206834)

| System | Node 20 | Node 22 | Node 24 |
|---|---:|---:|---:|
| macOS | 670 / 0 | 670 / 0 | 670 / 0 |
| Ubuntu Linux | 669 / 1 | 669 / 1 | 669 / 1 |
| Windows | 652 / 18 | 652 / 18 | 652 / 18 |

The skip lists match 0.9.0 on all three Node versions. Each Ubuntu job skipped `the refusal recognizes alternate home spelling on case-insensitive volumes` because the runner uses a case-sensitive filesystem. That test passed on macOS and Windows. [Ubuntu Node 20 job](https://github.com/workspace-labs/agent-health-checks/actions/runs/45754206834/job/139688875761)

Each Windows job skipped the following 18 symbolic-link tests. All 18 passed on macOS and Ubuntu. [Windows Node 20 job](https://github.com/workspace-labs/agent-health-checks/actions/runs/45754206834/job/139688875766)

| Test file under `tests/` | Test skipped on Windows |
|---|---|
| `project-coverage.test.js` | a symlinked info directory cannot supply ignore rules |
| `project-doctor-context.test.js` | ordinary in-project links stay visible without duplicating findings from their target |
| `project-doctor-reading.test.js` | TypeScript substitution refuses a matching source symlink escaping the project |
| `project-doctor-reading.test.js` | tablet symlinked metadata cannot exclude the snapshot |
| `project-doctor.test.js` | scan bounds and escaping symlinks remain visible |
| `project-doctor.test.js` | broken project symlinks are disclosed with a safe resolution code |
| `project-entry-checks.test.js` | links to external files and output directories cannot confirm missing main or bin |
| `project-import-resolution.test.js` | imports resolve internal file and directory links and refuse links crossing the project boundary |
| `project-import-resolution.test.js` | absolute internal links resolve through the spelling used to open the project |
| `project-import-resolution.test.js` | repeated metadata checks read a link only once per audit |
| `project-import-resolution.test.js` | a sibling link cannot prove an external import is missing |
| `project-report-noise.test.js` | 3000 broken links respect the file bound and fit in one ten-example notice |
| `project-report-noise.test.js` | a lone broken link keeps its path and reason and a valid internal link stays a distinct notice |
| `skill-doctor.test.js` | symlinks escaping a declared root are refused |
| `skill-doctor.test.js` | broken skill symlinks are explicit safety findings |
| `skill-doctor.test.js` | refused root symlinks still carry a stable, unique audit digest |
| `skill-references.test.js` | a reference passing through an external link cannot confirm presence or absence |
| `skill-references.test.js` | an internal link can resolve within the skill and normalized spellings on one line yield one finding |

### Read-only checks

Run `node --test tests/checker-source-policy.test.js tests/checker-read-only.test.js` for the nine focused checks. The source controls cover disallowed imports, write-capable filesystem calls, process launches and network APIs. The command tests give each checker a script, an executable and three install hooks that lead to a marker file. Each command ran normally and under Node’s permission switch with only filesystem reads granted. Both reports parsed, the marker stayed absent and the fingerprint of names, bytes, modes and modification times held. The controls deliberately ran the marker script, changed a fixture file and attempted a permission-denied write. All nine passed on every version above.

### Verdicts and rule codes

The verdict tables exercise each of the six skill statuses and four project statuses separately, including the display word, machine key and exact summary counts. On v0.9.0 both new header assertions failed with the former names. The verdict tests also failed on disposable copies given deliberately wrong verdict data.

The inventory below was collected from **emitted reports** in disposable copies, then checked against the rule sources. For skills, the counter observed each finalized skill's findings just before summary assembly. For projects, it observed both arrays returned by `auditProject`, including Unavailable reports. Before and after observations used the existing fixtures with a temporary home. The branch measurements used `node --test tests/skill-*.test.js` and `node --test tests/project-*.test.js` (280 and 379 tests respectively). All codes were already reached on v0.9.0. No additional rule-specific fixture was due for an unreached code.

| Report evidence | v0.9.0 reached / emitted | 0.10.0 reached / emitted |
|---|---:|---:|
| Skills Checker findings, including file-collection notices surfaced as findings | 45 / 45 | 45 / 45 |
| Project Checker findings | 30 / 30 | 30 / 30 |
| Project Checker notices | 22 / 22 | 22 / 22 |

Five project codes occur in both arrays, giving 47 distinct project codes. Skills coverage locations have a `kind` field and do not emit notice codes.

**Skills Checker findings in 0.13.0 (57 codes)**

`allowed-tools-extension`, `broken-reference`, `claude-description-angle-bracket`,
`claude-name-angle-bracket`, `claude-reserved-name`, `code-execution`, `compatibility-too-long`,
`credential-access`, `declared-dependency`, `decode-and-run`, `deep-reference`, `description-too-long`, `description-voice`,
`destructive-command`, `download-and-run`, `duplicate-name`, `empty-body`, `extra-frontmatter-fields`,
`folder-name-mismatch`, `frontmatter-hooks`, `hidden-characters`, `hidden-comment`, `hidden-from-menu`,
`invalid-name`, `invalid-yaml`, `load-time-command`, `long-body`, `look-alike-name`, `malformed-frontmatter`,
`missing-description`, `missing-name`, `missing-skill-md`, `model-specific-tool`, `name-too-long`,
`network-access`, `openai-default-prompt`, `openai-yaml-interface`, `oversized-file`, `personal-path`,
`reference-no-toc`, `safeguard-off`, `scan-limit`, `standing-file-write`, `symlink-root-escape`, `symlink-root-unresolved`, `symlink-skipped`,
`symlink-unresolved`, `thin-description`, `unclear-trigger`, `unread-directory`, `unread-files`,
`unreadable-directory`, `unreadable-file`, `unrestricted-shell-grant`, `unsupported-dependency-type`, `unverified-reference`,
`unverified-yaml`.

**Project Checker findings**

`broken-relative-import`, `code-not-examined`, `debug-residue`, `dynamic-code-execution`,
`electron-context-isolation`, `electron-node-integration`, `electron-sandbox-disabled`,
`electron-web-security`, `empty-catch`, `large-project-files`, `malformed-package-json`,
`metadata-limit`, `missing-lockfile`, `missing-package-bin`, `missing-package-entry`, `missing-readme`,
`missing-test-script`, `package-not-examined`, `project-root-refused`, `project-unavailable`,
`pwa-missing-manifest`, `pwa-missing-worker`, `scan-limit`, `secret-files-present`, `source-not-read`,
`symlink-escape`, `todo-concentration`, `unreadable-directory`, `unreadable-file`,
`unreadable-package-json`.

**Project Checker notices**

`binary-source-skipped`, `broken-import-limit`, `code-coverage`, `file-not-checked`,
`folders-not-judged`, `git-ignored-folders`, `import-not-checked`, `intentional-large-asset`,
`metadata-limit`, `nested-packages-not-judged`, `non-production-large-asset`, `oversized-text`,
`package-entry-not-built`, `project-artifact-excluded`, `scan-limit`, `symlink-escape`,
`symlink-skipped`, `symlink-unresolved`, `tooling-console-output`, `unreadable-directory`,
`unreadable-file`, `workspace-artifact-excluded`.

### Read-only comparison with v0.9.0

With the same working directory and default roots, run `node skills/audit-agent-skills/scripts/audit-skills.js --json --include-body` from each version, then repeat in terminal mode. On 26 November 2026 both versions exited 2 with **84 unique skills, 56 mirrors and 231 findings, including 18 duplicate-name findings**. Both reported 37 Universal, 46 Needs review and one Broken.

The comparison preserved formatting and byte order. It replaced only the top-level JSON release and generation timestamp with `VERSION` and `TIME`, and the checker name on the terminal summary line with `CHECKER`. The normalized JSON matched across 1,312,881 bytes (SHA-256 `b6c003881bdd6558b94a3cdfe225fb21907eb8861d3ff161b41aa0d7c51048ca`). The terminal output matched across 25,739 bytes (SHA-256 `418de71b523a2a2722f877e06fa7cf0ffca1bd4fc4a90cfba598b6c7fc880308`).

For the project comparison, run `node skills/audit-project-health/scripts/audit-project.js --path "$APP" --profile workspace --json` from each version with the same project. Both exited 0 with Watch. All four finding objects, including IDs, matched for `large-project-files`, `empty-catch`, `scan-limit` and `debug-residue`. Running `node skills/audit-agent-skills/scripts/audit-skills.js --root skills` on the shipped pair reported two Universal, zero findings and exit 0.

The README picture contains both uncut terminal outputs from separate sample folders on the same date, including the commands. The project example shows one missing README and the skills example shows two Universal skills.

## Original 98 tests

| Test file | Checks | Tests |
|---|---|---:|
| `tests/skill-doctor.test.js` | the Skills Checker | 11 |
| `tests/project-doctor.test.js` | the Project Checker: findings, labels, exclusions | 31 |
| `tests/project-doctor-reading.test.js` | the Project Checker: imports, TypeScript, file-name case, read limits | 40 |
| `tests/project-doctor-context.test.js` | the Project Checker: build output, archives, tool scripts | 16 |
| **Total** | | **98** |

## How many times it was tested

### Before this repo had tests (July to September 2026)

Both checkers were first developed inside the author's Workspace app. Every change was
a task card that had to pass the app's tests before a person accepted it.
**12 cards changed the checkers. All 12 passed and were accepted.**

| # | Date | What changed | Test result written on the card | Second-agent review |
|---:|---|---|---|---|
| 1 | 2026-07-25 | Skills Checker built | 9 passing fixtures | — |
| 2 | 2026-07-25 | Project Checker built | 26 passing tests | — |
| 3 | 2026-07-25 | Oversized data files reported as scan limits | 13/13 focused, 27/27 full | — |
| 4 | 2026-07-25 | Command-line `console.log` no longer flagged | 12/12 focused, 30/30 full | — |
| 5 | 2026-07-25 | Empty catch blocks removed from both checkers | 40/40 | — |
| 6 | 2026-07-25 | Large-file classification | 15/15 focused, 42/42 full | — |
| 7 | 2026-07-26 | Broken-import false alarm fixed | 17/17 focused, 56/56 full | — |
| 8 | 2026-07-27 | Proof and backup archives not flagged | 19 focused, 95 full | — |
| 9 | 2026-07-27 | Declared deliverable PDFs not flagged | 22/22 focused, 106/106 full | — |
| 10 | 2026-08-07 | Skills Checker: empty fingerprint fixed | 220/220 full | 1 round: tests confirmed; asked for a live end-to-end proof |
| 11 | 2026-09-01 | `*.bak` backup files skipped | full suite, 0 failures; 2 of the 4 new tests fail on the old code | 1 round: clear |
| 12 | 2026-09-02 | Demo, `tmp/` and skill-template folders treated as non-shipped | 32/32 focused, full suite 0 failures; the new test broken on purpose went red | 2 rounds: low finding, then fixed |

"Focused" means the checker's own tests. "Full" means the whole Workspace app suite.
In September the tests were moved into a new folder layout (2 review rounds, clear).
They were moved, not changed.

### When this repo got its tests (2026-10-09)

The first public commit on August 19 contained the write-up. Both checker scripts first appeared here on August 21 in `4556208`. The public scripts later fell behind the app. The October comparison used these revisions.

| Version | Commit | Result |
|---|---|---|
| Public copy before the October update | `e69e5df` | **69 / 98 pass, 29 fail** |
| Current copy | `5b85dd1` and later | **98 / 98 pass** |

The 29 failures are real bugs in the old copy. They cover TypeScript `.js` imports,
capital vs small letters in folder names, APK/AAB/TAR archives, build-output and
backup folders, and demo and template folders. The current copy fixes all of them.

The suite was then run **5 times in a row** on the current copy:
98/98 every time, 318–351 ms per run.

Environment: macOS 27.0.1, Apple silicon (arm64), Node 20.20.2.

### Foundation release (2026-11-25)

On macOS, the original suite at `9c9a5b7` and the expanded 0.2.0 suite both ran from the repository root with `node --test`.

| Node | Original suite | 0.2.0 suite | Failed | Skipped |
|---|---:|---:|---:|---:|
| 20.20.2 | 98/98 | 109/109 | 0 | 0 |
| 22.23.1 | 98/98 | 109/109 | 0 | 0 |
| 24.22.1 | 98/98 | 109/109 | 0 | 0 |
| 26.13.1 | 98/98 | 109/109 | 0 | 0 |

The 11 new tests cover release agreement, report formats and finding identity, command exit codes, and the scan commands in both skill guides. The command test also runs inside a sample project that carries its own same-named scripts.

### GitHub Actions on macOS, Linux, and Windows (2026-11-25)

All nine jobs ran `node --test` at commit `4598ead`. Each row gives the result for **each** of the three Node versions on that system. [GitHub Actions run 45681088269](https://github.com/workspace-labs/agent-health-checks/actions/runs/45681088269)

| System | Node versions | Tests per job | Passed | Skipped | Failed |
|---|---|---:|---:|---:|---:|
| macOS | 20, 22, 24 | 123 | 123 | 0 | 0 |
| Ubuntu Linux | 20, 22, 24 | 123 | 123 | 0 | 0 |
| Windows | 20, 22, 24 | 123 | 115 | 8 | 0 |

**Known Windows coverage gap.** Eight symbolic-link tests are disabled on Windows. Three cover escaping or broken skill links and the identity of refused root links. Five cover project links, including scan bounds, broken and internal links, TypeScript import resolution, and linked snapshot metadata. All eight ran on macOS and Ubuntu.

### Import context and React markup (0.3.0, 2026-11-25)

On macOS, `node --test` passed all 190 tests on each of Node 20.20.2, 22.23.1, 24.22.1 and 26.13.1. Each run had zero failures and zero skips. The suite contains the 123 release tests plus 30 tests in `tests/project-import-context.test.js` and 37 in `tests/project-import-markup.test.js`.

The same nine harmless examples produced eight false alarms on 0.2.0 and zero on 0.3.0. The reader copied from the app missed five of eight real imports following React markup. Version 0.3.0 reported all eight at the expected file and line, including with Windows line endings. Both controls passed. Each Node version also passed the one-second test for a 512 KiB input containing nested markup, templates and braces.

In separate command-line comparisons, a 1,107-file Electron project went from one confirmed finding to zero. Its other five findings matched in every field and in order. For four real missing imports in `.js`, `.mjs`, `.cjs` and `.ts`, the complete reports matched apart from `checkerVersion` with the same fixed clock in both fixture runs.

#### GitHub Actions results for 0.3.0

All nine jobs passed at commit `70f17e8`. Each row gives the counts for each listed Node version. [GitHub Actions run 45685837204](https://github.com/workspace-labs/agent-health-checks/actions/runs/45685837204)

| System | Node versions | Tests per job | Passed | Skipped | Failed |
|---|---|---:|---:|---:|---:|
| macOS | 20, 22, 24 | 190 | 190 | 0 | 0 |
| Ubuntu Linux | 20, 22, 24 | 190 | 190 | 0 | 0 |
| Windows | 20, 22, 24 | 190 | 182 | 8 | 0 |

Windows skipped the eight symbolic-link tests described above. All 67 new tests passed on Windows, including the React cases that check paths and line numbers with CRLF line endings.

The first macOS Node 22 job waited 15 minutes for a hosted runner. GitHub cancelled it before any steps ran. A single retry on the same commit passed all 190 tests. [First attempt](https://github.com/workspace-labs/agent-health-checks/actions/runs/45685837204/job/139458092327) · [Successful retry](https://github.com/workspace-labs/agent-health-checks/actions/runs/45685837204/job/139466993645)

### Project entry, manifest and import checks (0.4.0, 2026-11-26)

Run `node --test` from the repository root. On macOS the 190 existing tests and 55 new tests passed on each requested runtime. All four new test files clean up their own fixtures.

| Node | Passed | Failed | Skipped | 2,500-picture scan |
|---|---:|---:|---:|---:|
| 20.20.2 | 245 | 0 | 0 | 37.2 ms |
| 22.23.1 | 245 | 0 | 0 | 28.9 ms |
| 24.22.1 | 245 | 0 | 0 | 21.5 ms |
| 26.13.1 | 245 | 0 | 0 | 26.5 ms |

To repeat the example and control checks, run the following from the repository root.

```bash
node --test tests/project-entry-checks.test.js tests/project-manifest-reading.test.js tests/project-import-resolution.test.js tests/project-import-forms.test.js
node --test --test-name-pattern="512 KiB" tests/project-import-markup.test.js
```

The 16 reported examples were reproduced on v0.3.0 before the fixes. A second comparison ran the same fixtures against both versions. Valid startup files, declaration-only targets, directory package entries, external sibling files and the UTF-8 BOM manifest cleared. Missing entries and absent siblings stayed confirmed. Empty and UTF-16 manifests and the previously overlooked import forms became confirmed. At 31 broken imports the report showed the first 24 and disclosed the overflow. The 2,500-picture project found its README, its built entry and its real source error while still disclosing the file limit. Resolved imports and plain UTF-8 controls stayed quiet.

The existing 512 KiB nested-input reader test passed on all four runtimes. In a separate full scan on Node 22.14.0, the same 512 KiB source took 52.1 ms and reported both missing imports. The large-picture project took 24.8 ms in that comparison. A separate test exhausts the 1,024 metadata-read budget and verifies that cached answers still work and unverified paths produce notices.

A read-only comparison on a real Electron project returned Watch on both versions, with five findings, zero confirmed, two likely and three recommendations. The findings matched in order, wording and location. Both runs had the same nine notices. A root-file notice moved from fourth to first when root files were inspected first. The source digest and finding IDs changed because the text budget covered a different set of files. The checker repository itself reported Healthy with zero findings.

#### GitHub Actions results for 0.4.0

All nine jobs passed at commit `0107553`. Each column shows **passed / skipped** for one Node version. Each job ran the 245-test suite with zero failures. [GitHub Actions run 45692729366](https://github.com/workspace-labs/agent-health-checks/actions/runs/45692729366)

| System | Node 20 | Node 22 | Node 24 |
|---|---:|---:|---:|
| macOS | 245 / 0 | 245 / 0 | 245 / 0 |
| Ubuntu Linux | 245 / 0 | 245 / 0 | 245 / 0 |
| Windows | 232 / 13 | 232 / 13 | 232 / 13 |

**Known Windows coverage gap.** The suite skips the following 13 tests on Windows. Each creates a real symbolic link. All 13 passed on macOS and Ubuntu for all three Node versions. The first eight carried over from 0.3.0. The last five exercise behavior added in 0.4.0.

| Test file under `tests/` | Skipped test name |
|---|---|
| `project-doctor-context.test.js` | ordinary in-project links stay visible without duplicating findings from their target |
| `project-doctor-reading.test.js` | TypeScript substitution refuses a matching source symlink escaping the project |
| `project-doctor-reading.test.js` | tablet symlinked metadata cannot exclude the snapshot |
| `project-doctor.test.js` | scan bounds and escaping symlinks remain visible |
| `project-doctor.test.js` | broken project symlinks are disclosed with a safe resolution code |
| `skill-doctor.test.js` | symlinks escaping a declared root are refused |
| `skill-doctor.test.js` | broken skill symlinks are explicit safety findings |
| `skill-doctor.test.js` | refused root symlinks still carry a stable, unique audit digest |
| `project-entry-checks.test.js` | links to external files and output directories cannot confirm missing main or bin |
| `project-import-resolution.test.js` | imports resolve internal file and directory links and refuse links crossing the project boundary |
| `project-import-resolution.test.js` | absolute internal links resolve through the spelling used to open the project |
| `project-import-resolution.test.js` | repeated metadata checks read a link only once per audit |
| `project-import-resolution.test.js` | a sibling link cannot prove an external import is missing |

### Project coverage and audit limits (0.5.0, 2026-11-26)

On Apple silicon with macOS 27.2.1, each runtime ran the complete suite from the repository root with `node --test --test-reporter=tap`. The 245 existing cases and 73 new cases ran on each version.

| Node | Passed | Failed | Skipped |
|---|---:|---:|---:|
| 20.20.2 | 318 | 0 | 0 |
| 22.23.1 | 318 | 0 | 0 |
| 24.22.1 | 318 | 0 | 0 |
| 26.13.1 | 318 | 0 | 0 |

The new tests cover the 26 examples in the brief and their controls, including the corrected manifest-after-stop case. Run the new cases and the six earlier Step 2 and Step 3 test files with these commands.

```bash
node --test tests/project-coverage.test.js tests/project-source-rules.test.js tests/project-files-and-order.test.js tests/project-audit-limits.test.js
node --test tests/project-import-context.test.js tests/project-import-markup.test.js tests/project-entry-checks.test.js tests/project-manifest-reading.test.js tests/project-import-resolution.test.js tests/project-import-forms.test.js
```

The focused runs passed 73/73 and 122/122 on Node 22.23.1. The new suite removed every fixture from its isolated temporary directory. For the release comparison, a clean archive of v0.4.0 passed its original 245/245 tests. Running the 73 new cases against that archive gave 52 failures and 21 passes. A protected-file test observed file reads and checked that the report contained no fixture values. Fixed-clock tests spent the deadline during root listing, traversal, metadata lookup and report preparation.

Each number below is milliseconds for a separate full audit of a 512 KiB fixture, including launching the CLI and receiving its JSON. The test gives each child one second. On v0.4.0 the padded catch case exceeded that limit and the from control completed in 37.0 ms.

| Node | Empty catch | TODO | Debug | Dynamic code | Electron | From control |
|---|---:|---:|---:|---:|---:|---:|
| 20.20.2 | 56.8 | 68.3 | 66.7 | 91.2 | 72.6 | 42.1 |
| 22.23.1 | 55.9 | 55.6 | 94.2 | 100.7 | 66.7 | 41.7 |
| 24.22.1 | 64.7 | 49.7 | 76.2 | 86.2 | 83.8 | 59.6 |
| 26.13.1 | 75.5 | 52.6 | 90.5 | 76.9 | 75.5 | 68.3 |

Audits under Czech and Estonian locales reproduced different v0.4.0 fingerprints for the same two files, `ch.js` and `h.js`. The 0.5.0 reports agreed on the fingerprint, finding IDs, order and notices. Desktop metadata also left the new fingerprint unchanged.

The real Electron project returned Watch, five findings and zero confirmed on both releases. All five findings retained their wording, location and order. The changed inventory produced new IDs. The new report counted 239 JavaScript/TypeScript files examined. It named four other languages, one nested package, 13 skipped or sample directories and six literal Git directory exclusions. The nine earlier notices remained, with two moving down to accommodate new disclosures. The checker repository reported Healthy with zero findings.

The 0.5.0 runs above are local. The hosted macOS, Linux and Windows results further up this file belong to earlier releases.

#### 0.5.0 fix round 1

On the same Mac, `node --test --test-reporter=tap` passed 332/332 on each of Node 20.20.2, 22.23.1, 24.22.1 and 26.13.1, with zero skips. Running `node --test tests/project-source-rules.test.js tests/project-coverage.test.js` with the updated fixtures gave 10 failures on `3f1ec2f` and 65/65 passes after the fixes. Six failures covered global and indirect eval calls. Four covered markup and styles, including the same static site with and without a README. The real Electron project retained its five findings and its fingerprint.

#### GitHub Actions results for 0.5.0

All nine jobs passed on commit `9a8853f`. Each cell shows **passed / skipped** out of 332 tests. Every job reported zero failures. [GitHub Actions run 45699925951](https://github.com/workspace-labs/agent-health-checks/actions/runs/45699925951)

| System | Node 20.20.2 | Node 22.23.5 | Node 24.22.3 |
|---|---:|---:|---:|
| macOS | 332 / 0 | 332 / 0 | 332 / 0 |
| Ubuntu Linux | 332 / 0 | 332 / 0 | 332 / 0 |
| Windows | 318 / 14 | 318 / 14 | 318 / 14 |

**Known Windows coverage gap.** The Windows jobs skipped the 14 tests below. Each creates a real symbolic link. All 14 passed on macOS and Ubuntu for every Node version in the matrix. The new 0.5.0 case checks that a linked Git info directory cannot supply ignore rules. [Windows job log](https://github.com/workspace-labs/agent-health-checks/actions/runs/45699925951/job/139507053467)

| Test file under `tests/` | Skipped test name |
|---|---|
| `project-coverage.test.js` | a symlinked info directory cannot supply ignore rules |
| `project-doctor-context.test.js` | ordinary in-project links stay visible without duplicating findings from their target |
| `project-doctor-reading.test.js` | TypeScript substitution refuses a matching source symlink escaping the project |
| `project-doctor-reading.test.js` | tablet symlinked metadata cannot exclude the snapshot |
| `project-doctor.test.js` | broken project symlinks are disclosed with a safe resolution code |
| `project-doctor.test.js` | scan bounds and escaping symlinks remain visible |
| `project-entry-checks.test.js` | links to external files and output directories cannot confirm missing main or bin |
| `project-import-resolution.test.js` | a sibling link cannot prove an external import is missing |
| `project-import-resolution.test.js` | absolute internal links resolve through the spelling used to open the project |
| `project-import-resolution.test.js` | imports resolve internal file and directory links and refuse links crossing the project boundary |
| `project-import-resolution.test.js` | repeated metadata checks read a link only once per audit |
| `skill-doctor.test.js` | broken skill symlinks are explicit safety findings |
| `skill-doctor.test.js` | refused root symlinks still carry a stable, unique audit digest |
| `skill-doctor.test.js` | symlinks escaping a declared root are refused |

### Skills inventory and bundled references (0.6.0, 2026-11-26)

Each local runtime ran `node --test --test-reporter=tap` on macOS. The timing measures the inventory scan itself after creating 2,000 empty folders and one skill three levels deep. A separate CLI test put a link cycle in the container and required the child to finish within two seconds.

| Node | Passed | Failed | Skipped | Inventory scan |
|---|---:|---:|---:|---:|
| 20.20.2 | 388 | 0 | 0 | 34.9 ms |
| 22.23.1 | 388 | 0 | 0 | 52.7 ms |
| 24.22.1 | 388 | 0 | 0 | 34.9 ms |
| 26.13.1 | 388 | 0 | 0 | 34.8 ms |

Before implementation, the first 41 new cases produced 37 failures and four passing controls on v0.5.0. The complete set of 56 regression and control cases passed on 0.6.0. Replaying those same 56 cases on an archive of v0.5.0 produced 50 failures and six passes. The replay left zero fixture directories in its isolated temporary directory.

Run from the repository root:

```bash
node --test tests/skill-inventory.test.js tests/skill-collection.test.js tests/skill-references.test.js
node skills/audit-agent-skills/scripts/audit-skills.js --root skills
```

The fixtures cover linked installs, nested and hidden containers, individual skill roots, overlapping roots in both orders, explicit root errors, stable digests, cache and budget counts, and case-exact on-disk reference checks. Existing references remain valid beyond the read limit. The script safety control reports the same two findings in ordinary scripts and build output. Both shipped skills reported Universal with zero findings. The fixed digest fixture also passed under Czech and Estonian locale settings.

A read-only default-root comparison used `node skills/audit-agent-skills/scripts/audit-skills.js --json` on the same Mac. There were 87 unique skills, 243 findings, two Broken cards, 18 empty cards and 41 duplicate-name findings on v0.5.0. On 0.6.0 there were 93 unique skills, 411 findings, 16 Broken cards, zero empty cards and 23 duplicate-name findings. Both exited 2. The new scan counted 18 linked locations, discovered 19 skills in the synced container, and included eligible system and backup containers. Some reported relative paths occur in shell examples intended to run in the caller's project. The scan verifies the filesystem relative to the skill and cannot infer that caller's working directory.

#### 0.6.0 fix round 1

The same four local runtimes ran `node --test --test-reporter=tap`. Each passed 403/403 tests, with zero failures and zero skips. The focused cases can be repeated with:

```bash
node --test tests/skill-reference-verdicts.test.js tests/skill-hidden-roots.test.js
```

Replaying these 15 cases against the checker from `bd027d5` produced 12 failures and 3 passing controls. With the fix, a missing conventional script in the instructions still reports Broken. A caller's project command and a README picture both receive review findings. The discovery tests cover backup folders, system skills, hidden entries inside visible containers, links, and the roots header.

A read-only scan of the three default roots returned 84 unique skills, 367 findings, zero empty cards and 18 duplicate-name findings across 9 names. All 16 cards marked Broken by `bd027d5` cleared or fell outside discovery. One skill acquired a Broken verdict. Its instructions explicitly named two absent files in the conventional references directory. That explains exit 2.

#### GitHub Actions results for 0.6.0

All nine jobs passed on commit `066cadc`. Each cell shows **passed / skipped** out of 403 tests. Every job reported zero failures. [GitHub Actions run 45706582793](https://github.com/workspace-labs/agent-health-checks/actions/runs/45706582793)

| System | Node 20.20.2 | Node 22.23.5 | Node 24.22.3 |
|---|---:|---:|---:|
| macOS | 403 / 0 | 403 / 0 | 403 / 0 |
| Ubuntu Linux | 403 / 0 | 403 / 0 | 403 / 0 |
| Windows | 387 / 16 | 387 / 16 | 387 / 16 |

**Known Windows coverage gap.** The suite explicitly skips these 16 symbolic-link tests on Windows. All 16 passed on macOS and Ubuntu across all three Node versions. The two cases added in 0.6.0 check reference paths that cross an external link or resolve through an internal one. [Windows job log](https://github.com/workspace-labs/agent-health-checks/actions/runs/45706582793/job/139530007287)

| Test file under `tests/` | Skipped test name |
|---|---|
| `project-coverage.test.js` | a symlinked info directory cannot supply ignore rules |
| `project-doctor-context.test.js` | ordinary in-project links stay visible without duplicating findings from their target |
| `project-doctor-reading.test.js` | TypeScript substitution refuses a matching source symlink escaping the project |
| `project-doctor-reading.test.js` | tablet symlinked metadata cannot exclude the snapshot |
| `project-doctor.test.js` | broken project symlinks are disclosed with a safe resolution code |
| `project-doctor.test.js` | scan bounds and escaping symlinks remain visible |
| `project-entry-checks.test.js` | links to external files and output directories cannot confirm missing main or bin |
| `project-import-resolution.test.js` | a sibling link cannot prove an external import is missing |
| `project-import-resolution.test.js` | absolute internal links resolve through the spelling used to open the project |
| `project-import-resolution.test.js` | imports resolve internal file and directory links and refuse links crossing the project boundary |
| `project-import-resolution.test.js` | repeated metadata checks read a link only once per audit |
| `skill-doctor.test.js` | broken skill symlinks are explicit safety findings |
| `skill-doctor.test.js` | refused root symlinks still carry a stable, unique audit digest |
| `skill-doctor.test.js` | symlinks escaping a declared root are refused |
| `skill-references.test.js` | a reference passing through an external link cannot confirm presence or absence |
| `skill-references.test.js` | an internal link can resolve within the skill and normalized spellings on one line yield one finding |

## Running the checkers on real material

On 2026-10-09, both checkers were run on real material, not test fixtures:

- **Skills Checker** on a real toolbox of 66 skills: 34 universal, 26 needing review,
  4 broken. Example: two different skills sharing the name `frontend-design`.
- **Project Checker** on a real 1,087-file Electron app: 0 confirmed, 2 likely,
  1 recommendation, in 81 ms.
- **Both checkers on this repo itself:** 0 findings.

## Not tested

- **Node older than 20.** Not tried.
- **No record for the September 16 changes.** The TypeScript-import, file-name-case and
  `project-context.js` work has no written task card. Its tests are in this repo and pass,
  but there is no history of when or how it was first reviewed.
- **Second-agent review covered only cards 10–12.** Cards 1–9 were tested and accepted
  by a person, without a second agent reading the code.

### Skill rules and terminal reports (0.7.0, 2026-11-26)

The comparison used the published v0.6.0 tree at `a1154f1`. The new tests ran against that baseline first. The fixtures exercise the verdict with and without safety evidence, accepted and rejected YAML, agent field semantics, executable spellings and look-alikes, personal and portable paths, output grouping and literal JSON evidence. All sample commands are inspected as text. Run the four focused files from the repository root.

```sh
node --test tests/skill-yaml.test.js tests/skill-field-rules.test.js tests/skill-command-and-path-rules.test.js tests/skill-verdict-and-terminal.test.js
node --test --test-name-pattern="one MiB" tests/skill-yaml.test.js
node skills/audit-agent-skills/scripts/audit-skills.js --root skills
node skills/audit-agent-skills/scripts/audit-skills.js --json
```

**Local results.** On macOS 27.2.1, the four focused files passed 156/156. Against a temporary copy of the tagged 0.6.0 scripts, those same files gave 129 failures and 27 passes. The full suite ran with each exact runtime’s `node --test --test-reporter=tap`. The final column gives the test runner’s elapsed time for the one-MiB case, including its fixture setup and checks.

| Node | Passed | Failed | Skipped | One-MiB case |
|---|---:|---:|---:|---:|
| 20.20.2 | 559 | 0 | 0 | 138.5 ms |
| 22.23.1 | 559 | 0 | 0 | 74.8 ms |
| 24.22.1 | 559 | 0 | 0 | 70.1 ms |
| 26.13.1 | 559 | 0 | 0 | 81.4 ms |

**Terminal evidence on 0.6.0 (OUT-3).** Benign markers were used at the four input locations from the July proof. Neither a multiline Markdown link nor its carriage-return variant printed the trailing marker. An ignored multiline source comment also stayed outside the project report. A direction mark in a project symlink name reached the terminal unchanged. Separate checks found unescaped audited text in both terminal renderers. The regression suite verifies visible escapes in skill and project names, paths and quoted references while retaining their exact values in JSON. The historical cursor-control sequence was not replayed.

**Read-only toolbox comparison.** Both runs used the default installations on the same Mac. All 84 skill digests matched, and both runs had 56 identical mirrors and exit code 2.

| Version | Findings | Universal | Claude-ready | Codex-ready | Workspace-specific | Needs review | Broken |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0.6.0 | 367 | 23 | 1 | 0 | 3 | 56 | 1 |
| 0.7.0 | 373 | 21 | 0 | 0 | 0 | 61 | 2 |

| Skill | Change | Evidence |
|---|---|---|
| animate | Universal → Needs review | Package commands in two shell blocks. |
| find-skills | Universal → Needs review | A shell block invokes npx. |
| mcp-builder | Workspace-specific → Universal | Its two home-relative path findings cleared. |
| peer-review | Workspace-specific → Needs review | The personal-path finding cleared. Unverified references remain. |
| playwright | Claude-ready → Needs review | Shell package commands in its instructions and script take priority over the Codex default-prompt note. |
| trade-off-analysis | Universal → Broken | SKILL.md line 3 contains colon-space in a plain YAML description. This is the only new Broken skill. |
| ui-ux-pro-max | Workspace-specific → Needs review | The personal-path finding cleared. Executable code still requires review. |

| Safety code | 0.6.0 | 0.7.0 |
|---|---:|---:|
| destructive-command | 1 | 8 |
| code-execution | 43 | 28 |
| network-access | 22 | 30 |

Counts are findings per unique skill, file and rule. Both shipped skills report Universal when scanned together. The one-MiB test measures the entire scanner subprocess, including JSON output, against a one-second limit.

#### GitHub Actions for 0.7.0

All nine jobs passed on commit `605692d`. Each cell shows **passed / skipped** out of 559 tests. Every job reported zero failures. [GitHub Actions run 45710824616](https://github.com/workspace-labs/agent-health-checks/actions/runs/45710824616)

| System | Node 20 | Node 22 | Node 24 |
|---|---:|---:|---:|
| macOS | 559 / 0 | 559 / 0 | 559 / 0 |
| Ubuntu Linux | 559 / 0 | 559 / 0 | 559 / 0 |
| Windows | 543 / 16 | 543 / 16 | 543 / 16 |

Each Windows job skipped the same 16 symbolic-link tests, listed below. All 16 passed on macOS and Ubuntu across the three Node versions. [Windows job log](https://github.com/workspace-labs/agent-health-checks/actions/runs/45710824616/job/139544482512)

| Test file under `tests/` | Skipped test name |
|---|---|
| `project-coverage.test.js` | a symlinked info directory cannot supply ignore rules |
| `project-doctor-context.test.js` | ordinary in-project links stay visible without duplicating findings from their target |
| `project-doctor-reading.test.js` | TypeScript substitution refuses a matching source symlink escaping the project |
| `project-doctor-reading.test.js` | tablet symlinked metadata cannot exclude the snapshot |
| `project-doctor.test.js` | broken project symlinks are disclosed with a safe resolution code |
| `project-doctor.test.js` | scan bounds and escaping symlinks remain visible |
| `project-entry-checks.test.js` | links to external files and output directories cannot confirm missing main or bin |
| `project-import-resolution.test.js` | a sibling link cannot prove an external import is missing |
| `project-import-resolution.test.js` | absolute internal links resolve through the spelling used to open the project |
| `project-import-resolution.test.js` | imports resolve internal file and directory links and refuse links crossing the project boundary |
| `project-import-resolution.test.js` | repeated metadata checks read a link only once per audit |
| `skill-doctor.test.js` | broken skill symlinks are explicit safety findings |
| `skill-doctor.test.js` | refused root symlinks still carry a stable, unique audit digest |
| `skill-doctor.test.js` | symlinks escaping a declared root are refused |
| `skill-references.test.js` | a reference passing through an external link cannot confirm presence or absence |
| `skill-references.test.js` | an internal link can resolve within the skill and normalized spellings on one line yield one finding |

### Project Checker options and coverage (0.8.0, 2026-11-26)

From the repository root, run the full tests with each requested Node binary. The focused commands below exercise both command-line forms, usage errors, refusal before reading, source order, link accounting, notice grouping, missing imports and eval spellings.

```sh
node --test --test-reporter=tap
node --test tests/project-cli-options.test.js tests/project-source-budget.test.js tests/project-report-noise.test.js
node --test tests/project-import-forms.test.js tests/project-source-rules.test.js tests/project-coverage.test.js tests/project-doctor-reading.test.js tests/project-doctor-context.test.js tests/project-doctor.test.js
```

**Full local suite.** Each of Node 20.20.2, 22.23.1, 24.22.1 and 26.13.1 passed 621/621 tests on macOS, with zero failures and zero skips. This includes the 559 tests carried forward from 0.7.0. Focused checks also covered file growth between inventory and opening, time spent listing a directory, and a filename disappearing after inventory. Read tracking covered both opening a descriptor and reading by pathname.

**Before implementation.** The CLI and path tests produced 16 failures on v0.7.0. The source budget tests had six failures and one passing control. The five noise tests failed. Across the six profile, import and source-rule files, 29 cases failed and 161 passed. The 100-byte root README hid `src/app.js` on v0.7.0. Its one-byte control exposed the same `eval(x);` call.

**CLI reproduction on Node 22.23.1.** File and link fixtures used temporary folders, with the home-folder cases run under a temporary home. The old checker required the module's `limits` property for a byte-bound comparison.

| Input | 0.7.0 exit | 0.8.0 exit | 0.8.0 observation |
|---|---:|---:|---|
| Missing path target or path to a file | 0 | 1 | Unavailable report |
| Confirmed missing relative import | 0 | 2 | Needs attention. The resolved-import control exits 0. |
| Unknown `--jsno` | 0 | 1 | One diagnostic plus usage |
| `--max-files 5` on 13 files | 0 | 0 | 5 files collected. Omitting it retains the default of 2,400. |
| `--path=<folder>` | 2 | 0 | Same Healthy report as the space form |
| `--path --json` | 0 | 1 | Missing value, also when a folder named `--json` exists |
| Omit `--path` | 2 | 1 | Usage error. Help and version still exit 0. |
| Home, its parent or its symlink | 0 | 1 | Refused before listing. A project under home exits 0. |
| Duplicate missing import on one line | 0 | 2 | One finding and one ID. Two different imports or two source lines retain two IDs. |
| Bracket or optional global eval call | 0 | 2 | Dynamic-code finding. Dotted global eval stays detected. Unrelated objects and inert text exit 0. |
| 600 KiB HTML and extensionless zero-filled file | 0 | 0 | Healthy. Each path appears once. The latter is classified as binary. |
| 200,000-byte budget and two 120,000-byte sources | CLI ignored limit | 0 | Watch. The unread-source finding names `b.js, z.js`. With room for all three sources, the eval finding exits 2. |
| 100-byte budget, 100-byte root README, nested eval source | CLI ignored limit | 2 | Needs attention. Both the large README and its one-byte control leave the eval visible. |
| 3,000 broken links, three ordinary files | 0 | 0 | 2,397 links charged to 2,400 file slots, one counted link notice and one scan-limit finding. Terminal output fell from 21,009 lines to 17. JSON fell from about 2 MB to about 2 KB. |
| Ordinary project with Workspace-shaped paths | 0 | 2 | Checks `.trash/`, the backup file, demos and the skill template by default. The workspace profile exits 0 for the same fixture. |

The real unreadable-directory control returned Unavailable and exit 1. The link-only regression fixture also checks all 2,400 admitted links in one counted notice, the first ten paths, fewer than 100 terminal lines and less than 100 KB of JSON.

**Read-only app comparison.** Run the Project Checker from a temporary archive of `v0.7.0` and from this checkout. Use the same absolute project path for all three runs.

```sh
node skills/audit-project-health/scripts/audit-project.js --path "$APP" --json
node skills/audit-project-health/scripts/audit-project.js --path "$APP" --profile workspace --json
```

| Checker and project profile | Exit | Status | Findings | Confirmed | Likely | Recommendations | High | Notices | Sources examined |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| v0.7.0 | 0 | Watch | 5 | 0 | 2 | 3 | 0 | 13 | 239 |
| 0.8.0 workspace | 0 | Watch | 4 | 0 | 2 | 2 | 0 | 11 | 239 |
| 0.8.0 default | 2 | Needs attention | 8 | 0 | 6 | 2 | 4 | 9 | 252 |

The workspace run retained the large-file finding for the project brief PDF, three empty catches, the total-byte limit and 50 debug statements. The former fifth finding, `oversized-text` for `.tally-core.tap`, is now a notice. The priority change altered which files fit in the byte budget, so the report digest and the IDs derived from it changed. Both 0.8.0 runs read every eligible source discovered in the app.

The default included the demo scripts. It found four high `electron-web-security` findings, for `demomeasure.js:16`, `demoshot.js:9`, `demotype.js:6` and `strip.js:39` under `demos/redesign-shell/_tools/`. The empty-catch count rose from 3 to 33, debug statements from 50 to 73, and files over 1 MiB from 1 to 14. The largest was `demos/redesign-shell/delivery-after.png`. The total-byte limit still applied. The app's own ignore rules excluded three Workspace folders under both profiles.

**Skills parity.** From each checkout, run `node skills/audit-agent-skills/scripts/audit-skills.js --root skills --json` and again without `--root skills`. In both versions, the two bundled skills were Universal with zero findings and exit 0. On the same installed toolbox both checkers exited 2 with 84 skills, 56 mirrors, 372 findings, 22 Universal, 61 Needs review and one Broken. All 84 skill digests matched. The 0.7.0 release-day count above records an earlier toolbox snapshot.

**Step 5 fix round 1.** All four Node versions above passed 624/624 tests with zero skips. On `9c4bae8`, 40 source files of 400,000 bytes exhausted the default budget and hid the missing test script. The corrected checker reports both `missing-test-script` and `source-not-read`. The eight-byte source-order test now uses a nested package manifest because only the root manifest takes precedence over source. The 100-byte README fixture and its one-byte control still detect eval.

On the same baseline, a second `--path` silently selected the second folder. The corrected CLI exits 1 with empty stdout and one diagnostic on stderr. The regression tests cover the missing-first-folder example and all eight value options across the two argument forms. The read-only app audit with `--profile workspace` again returned Watch with the same four findings.

#### GitHub Actions for 0.8.0

All nine jobs passed on commit `c090266`. Each cell shows **passed / skipped** out of 624 tests. Every job reported zero failures. [GitHub Actions run 45745648718](https://github.com/workspace-labs/agent-health-checks/actions/runs/45745648718)

| System | Node 20 | Node 22 | Node 24 |
|---|---:|---:|---:|
| macOS | 624 / 0 | 624 / 0 | 624 / 0 |
| Ubuntu Linux | 623 / 1 | 623 / 1 | 623 / 1 |
| Windows | 606 / 18 | 606 / 18 | 606 / 18 |

Each Ubuntu job skipped `the refusal recognizes alternate home spelling on case-insensitive volumes` because the runner's filesystem is case-sensitive. This test passed on macOS and Windows. [Ubuntu job log](https://github.com/workspace-labs/agent-health-checks/actions/runs/45745648718/job/139660911231)

Each Windows job skipped the 16 symbolic-link tests carried forward from 0.7.0 and two link-reporting tests added in 0.8.0. All 18 passed on macOS and Ubuntu. [Windows job log](https://github.com/workspace-labs/agent-health-checks/actions/runs/45745648718/job/139660911070)

| Test file under `tests/` | Skipped test name | Windows skip |
|---|---|---|
| `project-coverage.test.js` | a symlinked info directory cannot supply ignore rules | Carried forward |
| `project-doctor-context.test.js` | ordinary in-project links stay visible without duplicating findings from their target | Carried forward |
| `project-doctor-reading.test.js` | TypeScript substitution refuses a matching source symlink escaping the project | Carried forward |
| `project-doctor-reading.test.js` | tablet symlinked metadata cannot exclude the snapshot | Carried forward |
| `project-doctor.test.js` | scan bounds and escaping symlinks remain visible | Carried forward |
| `project-doctor.test.js` | broken project symlinks are disclosed with a safe resolution code | Carried forward |
| `project-entry-checks.test.js` | links to external files and output directories cannot confirm missing main or bin | Carried forward |
| `project-import-resolution.test.js` | imports resolve internal file and directory links and refuse links crossing the project boundary | Carried forward |
| `project-import-resolution.test.js` | absolute internal links resolve through the spelling used to open the project | Carried forward |
| `project-import-resolution.test.js` | repeated metadata checks read a link only once per audit | Carried forward |
| `project-import-resolution.test.js` | a sibling link cannot prove an external import is missing | Carried forward |
| `project-report-noise.test.js` | 3000 broken links respect the file bound and fit in one ten-example notice | New in 0.8.0 |
| `project-report-noise.test.js` | a lone broken link keeps its path and reason and a valid internal link stays a distinct notice | New in 0.8.0 |
| `skill-doctor.test.js` | symlinks escaping a declared root are refused | Carried forward |
| `skill-doctor.test.js` | broken skill symlinks are explicit safety findings | Carried forward |
| `skill-doctor.test.js` | refused root symlinks still carry a stable, unique audit digest | Carried forward |
| `skill-references.test.js` | a reference passing through an external link cannot confirm presence or absence | Carried forward |
| `skill-references.test.js` | an internal link can resolve within the skill and normalized spellings on one line yield one finding | Carried forward |

### Skills Checker noise and options (0.9.0, 2026-11-26)

On macOS, v0.8.0 at `9b1edb8` passed its original 624 tests on Node 20.20.2. Before implementation, 32 tests failed against the released checker with the Step 6 expectations in place. The final suite also exercises hidden links, a shared directory-counting deadline, and Markdown examples that resemble links.

| Node | Command | Passed | Failed | Skipped |
|---|---|---:|---:|---:|
| 20.20.2 | `node --test` | 648 | 0 | 0 |
| 22.23.1 | `node --test` | 648 | 0 | 0 |
| 24.22.1 | `node --test` | 648 | 0 | 0 |
| 26.13.1 | `node --test` | 648 | 0 | 0 |

All ten CLI examples were exercised with separate fixture roots. The JSON and CSV data files, early TOC, directly linked nested document, README product names and declared target all produced Universal with exit 0. The three-document chain reported the two indirect references and exited 0. The two review skills stayed Universal and ranked first together. The destructive script kept its finding and exited 2. The empty explicit root exited 1. Controls included a long guide lacking contents, a missing bundled link, an undeclared tool, a harmless script and an unavailable root.

On the same read-only default inventory, both versions judged 84 skills and exited 2. Findings fell from 372 to 231 and unverified references from 147 to 10. The original CLI JSON was 1,359,607 UTF-8 bytes, including 1,075,375 bytes of serialized bodies and frontmatter values. The 0.9.0 CLI emitted 234,907 bytes by default and 1,312,223 with `--include-body`. All 84 full skill objects matched the module output after JSON serialization. The two shipped skills each reported Universal with zero findings. A read-only Workspace project scan with `--profile workspace` retained Watch and all four original finding objects, including their IDs.

#### GitHub Actions for 0.9.0

All nine jobs passed on commit `64f1652`. Each cell shows **passed / skipped** out of 649 tests. Every job had zero failures. [GitHub Actions run 45750414917](https://github.com/workspace-labs/agent-health-checks/actions/runs/45750414917)

| System | Node 20 | Node 22 | Node 24 |
|---|---:|---:|---:|
| macOS | 649 / 0 | 649 / 0 | 649 / 0 |
| Ubuntu Linux | 648 / 1 | 648 / 1 | 648 / 1 |
| Windows | 631 / 18 | 631 / 18 | 631 / 18 |

The corrected coverage walk skips nested links and junctions. The original Windows junction test and the new parent-loop test ran and passed in all nine jobs. [Windows Node 20 job](https://github.com/workspace-labs/agent-health-checks/actions/runs/45750414917/job/139676571722)

Each Ubuntu job skipped `the refusal recognizes alternate home spelling on case-insensitive volumes` because its filesystem is case-sensitive. This test passed on macOS and Windows. [Ubuntu Node 20 job](https://github.com/workspace-labs/agent-health-checks/actions/runs/45750414917/job/139676571785)

Each Windows job skipped the same 18 symbolic-link tests as 0.8.0. All 18 passed on macOS and Ubuntu.

| Test file under `tests/` | Test skipped on Windows |
|---|---|
| `project-coverage.test.js` | a symlinked info directory cannot supply ignore rules |
| `project-doctor-context.test.js` | ordinary in-project links stay visible without duplicating findings from their target |
| `project-doctor-reading.test.js` | TypeScript substitution refuses a matching source symlink escaping the project |
| `project-doctor-reading.test.js` | tablet symlinked metadata cannot exclude the snapshot |
| `project-doctor.test.js` | scan bounds and escaping symlinks remain visible |
| `project-doctor.test.js` | broken project symlinks are disclosed with a safe resolution code |
| `project-entry-checks.test.js` | links to external files and output directories cannot confirm missing main or bin |
| `project-import-resolution.test.js` | imports resolve internal file and directory links and refuse links crossing the project boundary |
| `project-import-resolution.test.js` | absolute internal links resolve through the spelling used to open the project |
| `project-import-resolution.test.js` | repeated metadata checks read a link only once per audit |
| `project-import-resolution.test.js` | a sibling link cannot prove an external import is missing |
| `project-report-noise.test.js` | 3000 broken links respect the file bound and fit in one ten-example notice |
| `project-report-noise.test.js` | a lone broken link keeps its path and reason and a valid internal link stays a distinct notice |
| `skill-doctor.test.js` | symlinks escaping a declared root are refused |
| `skill-doctor.test.js` | broken skill symlinks are explicit safety findings |
| `skill-doctor.test.js` | refused root symlinks still carry a stable, unique audit digest |
| `skill-references.test.js` | a reference passing through an external link cannot confirm presence or absence |
| `skill-references.test.js` | an internal link can resolve within the skill and normalized spellings on one line yield one finding |
