# Testing

How these two checkers were tested, how often, and what was never tested.
Every number below comes from a run that actually happened. Nothing is rounded up.

## Run the tests yourself

```bash
node --test
```

Run from the repository root. The suite uses Node’s built-in test runner and creates its fixtures in the system temporary directory. See the dated runs below for the exact versions tested.

### Original 98 tests

| Test file | Checks | Tests |
|---|---|---:|
| `tests/skill-doctor.test.js` | the skills checker | 11 |
| `tests/project-doctor.test.js` | the project checker: findings, labels, exclusions | 31 |
| `tests/project-doctor-reading.test.js` | the project checker: imports, TypeScript, file-name case, read limits | 40 |
| `tests/project-doctor-context.test.js` | the project checker: build output, archives, tool scripts | 16 |
| **Total** | | **98** |

## How many times it was tested

### Before this repo had tests (July to September 2026)

Both checkers were built and fixed inside the author's Workspace app. Every change was
a task card that had to pass the app's tests before a person accepted it.
**12 cards changed the checkers. All 12 passed and were accepted.**

| # | Date | What changed | Test result written on the card | Second-agent review |
|---:|---|---|---|---|
| 1 | 2026-07-25 | Skills checker built | 9 passing fixtures | — |
| 2 | 2026-07-25 | Project checker built | 26 passing tests | — |
| 3 | 2026-07-25 | Oversized data files reported as scan limits | 13/13 focused, 27/27 full | — |
| 4 | 2026-07-25 | Command-line `console.log` no longer flagged | 12/12 focused, 30/30 full | — |
| 5 | 2026-07-25 | Empty catch blocks removed from both checkers | 40/40 | — |
| 6 | 2026-07-25 | Large-file classification | 15/15 focused, 42/42 full | — |
| 7 | 2026-07-26 | Broken-import false alarm fixed | 17/17 focused, 56/56 full | — |
| 8 | 2026-07-27 | Proof and backup archives not flagged | 19 focused, 95 full | — |
| 9 | 2026-07-27 | Declared deliverable PDFs not flagged | 22/22 focused, 106/106 full | — |
| 10 | 2026-08-07 | Skills checker: empty fingerprint fixed | 220/220 full | 1 round: tests confirmed; asked for a live end-to-end proof |
| 11 | 2026-09-01 | `*.bak` backup files skipped | full suite, 0 failures; 2 of the 4 new tests fail on the old code | 1 round: clear |
| 12 | 2026-09-02 | Demo, `tmp/` and skill-template folders treated as non-shipped | 32/32 focused, full suite 0 failures; the new test broken on purpose went red | 2 rounds: low finding, then fixed |

"Focused" means the checker's own tests. "Full" means the whole Workspace app suite.
In September the tests were moved into a new folder layout (2 review rounds, clear).
They were moved, not changed.

### When this repo got its tests (2026-10-09)

The copy published here in July had fallen behind. Running the same tests against
both versions showed it:

| Version | Commit | Result |
|---|---|---|
| July copy (as first published) | `e69e5df` | **69 / 98 pass, 29 fail** |
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

## Running the checkers on real material

On 2026-10-09, both checkers were run on real material, not test fixtures:

- **Skills checker** on a real toolbox of 66 skills: 34 universal, 26 needing review,
  4 broken. Example: two different skills sharing the name `frontend-design`.
- **Project checker** on a real 1,087-file Electron app: 0 confirmed, 2 likely,
  1 recommendation, in 81 ms.
- **Both checkers on this repo itself:** 0 findings.

## Not tested

- **Node older than 20.** Not tried.
- **No record for the September 16 changes.** The TypeScript-import, file-name-case and
  `project-context.js` work has no written task card. Its tests are in this repo and pass,
  but there is no history of when or how it was first reviewed.
- **Second-agent review covered only cards 10–12.** Cards 1–9 were tested and accepted
  by a person, without a second agent reading the code.
