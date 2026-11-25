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
