# Testing

How these two checkers were tested, how often, and what was never tested.
Every number below comes from a run that actually happened. Nothing is rounded up.

## Run the tests yourself

```bash
node --test tests/
```

Node 20 or newer. Nothing to install. The tests build small throwaway projects and skills
in your temp folder and delete nothing else.

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

## Running the checkers on real material

The same day, both checkers were run on real material, not test fixtures:

- **Skills checker** on a real toolbox of 66 skills: 34 universal, 26 needing review,
  4 broken. Example: two different skills sharing the name `frontend-design`.
- **Project checker** on a real 1,087-file Electron app: 0 confirmed, 2 likely,
  1 recommendation, in 81 ms.
- **Both checkers on this repo itself:** 0 findings.

## Not tested

- **Windows and Linux.** Every run above was on macOS.
- **Node older than 20.** Not tried.
- **No record for the September 16 changes.** The TypeScript-import, file-name-case and
  `project-context.js` work has no written task card. Its tests are in this repo and pass,
  but there is no history of when or how it was first reviewed.
- **Second-agent review covered only cards 10–12.** Cards 1–9 were tested and accepted
  by a person, without a second agent reading the code.
