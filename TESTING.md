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
