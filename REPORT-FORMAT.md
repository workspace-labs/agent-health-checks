# JSON report formats

Pass `--json` to either checker. Both reports use `schemaVersion: 1` and identify the release in `checkerVersion`. A skills report groups findings by installed skill in `skills`. A project report has a top-level `findings` array.

## Skills report

| Top-level key | Meaning |
|---|---|
| `schemaVersion`, `checkerVersion` | Numeric schema version (`1`) and the checker release string. |
| `generatedAt` | UTC timestamp for this run in ISO 8601 format. |
| `readOnly`, `disclaimer` | The boolean `true` and the description of the scan's limits. |
| `roots` | Each requested root has `id`, `label`, `path`, `exists`, `state` and a `skills` count. The four state strings are `read`, `missing`, `not a folder` and `unreadable`. An existing root that cannot be listed retains `unreadable: true`. The optional `containers` array contains `{ name, skills }` for each top-level container, recording its folder name and number of discovered skills. Optional `notSearched` lists hidden entries skipped during discovery as paths relative to that root. |
| `summary` | Counts of unique `skills`, identical `mirrors`, `findings`, and one count per key in `statuses`. |
| `skills` | Array of unique skills. Copies with the same name and digest share an entry, retain findings from each installation and take the worst status. Multiple physical copies with the same name within one root raise a duplicate-name finding. A recognized linked installation adds a source to the target card. |

Each skill contains `id`, `name`, `folder`, `description`, `body` (trimmed instruction text), `frontmatter`, `digest`, `fileCount`, `totalBytes`, `sources`, `findings`, `axes`, `status`, `statusKey` and `counts` (`errors` and `review`).

| Status key | Printed label |
|---|---|
| `universal` | Universal |
| `claude` | Claude-ready |
| `codex` | Codex-ready |
| `workspace` | Workspace-specific |
| `review` | Needs review |
| `broken` | Broken |

`axes` grades `structure`, `triggers`, `safety`, `portability`, `claude` and `codex`. Each grade is `pass`, `review` or `fail`. A finding has seven keys.

| Finding key | Meaning |
|---|---|
| `file`, `line` | **Identity.** Evidence path and one-based line. A missing instruction file can still be identified as `SKILL.md`, line 1. |
| `code`, `message`, `axis` | **Identity.** Rule code, exact message text, and one of the six axes. |
| `severity` | `error` or `review`. |
| `suggestion` | Suggested next action. |

Finding identity also includes the enclosing skill's **digest and list of install locations**. Each entry in `sources` contains the root's `id`, `label` and displayed `root`, the installed folder's `path` and the `skillMd` path. A linked install adds `isLink: true` to its source. Ordinary sources have the original five fields. Home-relative paths display with a leading `~`. The list preserves root traversal order. When a top-level install link identifies a skill deeper than normal discovery under overlapping roots, the most specific eligible root owns its target. Skills findings do not carry a separate finding ID or confidence level.

The skill's `id` joins its name and digest with a colon. The digest is 64 lowercase hexadecimal characters. For an ordinary skill, sort scanned files by relative path in UTF-16 code-unit order. Omit `.DS_Store`, `Thumbs.db` and `desktop.ini`. Hash UTF-8 text with CRLF normalized to LF. Hash binary or non-UTF-8 files with their original bytes. Both use SHA-256. Use the marker `oversized:<size>` for an oversized file. Feed each relative path, a NUL byte, the hash or marker, and a final NUL byte into the outer SHA-256. A matching digest describes the scanned content. The unread findings give the extent of excluded content. For a refused root symlink, the hash input consists of the following NUL-separated values in order. It starts with the literal `skill-symlink-refusal`, rule code, entry name, displayed root, displayed link path, and either the resolution error code or the displayed resolved path.

The terminal report starts with root states and labels skipped hidden entries “not searched”. An unavailable explicit root exits **1**, including when another root contains a Broken skill. A missing default root is quiet in the terminal. The JSON report includes the state of each requested root. A completed scan exits **2** when any skill is Broken and **0** otherwise. A missing argument to `--root`, an unknown option or a caught failure exits **1**. Help and version requests exit **0**.

The CommonJS module exports the functions `auditSkillRoots`, `parseFrontmatter` and `overlapScore`, plus `AXES` and `DEFAULT_LIMITS`. The functions return their results synchronously.

### Skill findings added in 0.6.0

All three codes use the structure axis and review severity. Angle brackets mark variable values.

| Code | Exact message |
|---|---|
| `unread-directory` | `Skipped <relative directory> (unread files: <n>)` |
| `unread-files` | `Files not read because of scan limits: <n>` |
| `unverified-reference` | `Could not verify reference: <reference>` |

A missing file can produce `broken-reference` only when `SKILL.md` or `agents/openai.yaml` claims a bundled file through an internal Markdown link outside code or a path under `scripts/`, `references/` or `assets/`. Those folder paths can start with `./` or `${CLAUDE_SKILL_DIR}/`. Unresolved paths in other Markdown files, uncertain inputs and links leaving the skill produce `unverified-reference` with review severity.

The existing `symlink-root-escape` finding now uses the structure axis and the message `Refused skill symlink escaping <root>. Target <target> was not checked.` Its severity is review. Refused install links are excluded from duplicate-name checks.

## Project report

| Top-level keys | Value |
|---|---|
| `schemaVersion`, `checkerVersion`, `readOnly` | Schema number `1`, checker release string, `true`. |
| `projectId`, `projectName`, `root` | Identifier, display name and absolute path. Accessible roots use their real path. |
| `digest` | 64 lowercase hexadecimal characters, produced by SHA-256. |
| `status`, `statusKey`, `stack` | Display label, machine key and array of detected stack labels. An unavailable root reports `["Unknown"]`. |
| `summary` | Integer counts named `findings`, `confirmed`, `likely`, `recommendation` and `high`. The last counts both high and critical findings. |
| `findings`, `notices` | Arrays. Each notice carries `code` and `message` and may include `actionable` and `classification`. |
| `limits` | Numeric bounds named `maxFiles`, `maxFileBytes`, `maxTotalBytes` and `maxDurationMs`. |
| `fileCount`, `totalBytes`, `durationMs`, `disclaimer` | Collected file count, bytes counted by the scan, elapsed wall time for the whole audit in milliseconds (including rules and report preparation) and a static-analysis disclaimer. |

Status keys and labels are `healthy` (Healthy), `watch` (Watch), `attention` (Needs attention) and `unavailable` (Unavailable). A confirmed or high/critical finding produces Needs attention. Other findings produce Watch. An accessible project with zero findings reports Healthy.

Each finding has `code`, `category`, `severity`, `confidence`, `message`, `file`, `line`, `impact`, `verify`, `recommendation` and `id`. Severity ranks are `critical`, `high`, `medium` and `low`. The current rules emit the latter three. Confidence values are `confirmed`, `likely` and `recommendation`. The file is a project-relative path with forward slashes, or `.` for project-level evidence. Lines begin at 1. A counted finding can point only to its first example.

**Identity.** Resolve a project finding using the report's `digest` together with its finding `id`. The ID is the first 24 lowercase hex characters of SHA-256 over the UTF-8 JSON object containing `reportDigest` followed by the ten finding fields listed above in order, ending with `recommendation`. This makes the rule code, exact message, location and all other finding text significant. Project findings have no axis or list of install locations.

The report digest hashes the collected relative paths paired with their file digests, sorted in UTF-16 code-unit order on the paths. A NUL separates each path and digest and each pair. Read file bytes contribute a SHA-256 hex digest. Recognized binary extensions, protected names and oversized files contribute size markers such as `binary:3`, `secret:4` and `oversized:5`. An empty collection hashes `empty:<real root>`. An unavailable root hashes `unavailable:<requested absolute path>:<error message>`. An unavailable digest depends on the path and error text. Desktop metadata files (`.DS_Store`, `Thumbs.db`, and `desktop.ini`) contribute neither paths nor bytes.

**CLI.** A completed report exits 0 for every status, including Needs attention and Unavailable. Omitting the required path exits 2. Standalone help and version requests exit 0.

**CommonJS exports.** `auditProject`, `collectProject`, `humanReport`, `isIntentionalReferenceData` and `resolveFinding` are synchronous functions. The module also exports the `DEFAULT_LIMITS` object. A successful `resolveFinding(report, { digest, findingId })` returns `{ report, finding }`. An unmatched digest or ID returns `null`.

### Project rules and notices added in 0.4.0

The following are the exact message templates. Angle brackets mark values supplied by the scan. Both findings use severity `high`, confidence `confirmed` and file `package.json`.

| Finding code | Message |
|---|---|
| `missing-package-bin` | `package.json declares a missing bin entry: <entry>` |
| `unreadable-package-json` | `Cannot read package.json as UTF-8 JSON because <reason>.` |

The values for `<reason>` are `the file is empty`, `the file is UTF-16`, `the file contains zero bytes`, `the file contains invalid UTF-8`, `access was denied` and `the file read failed`. The UTF-16 reason requires its byte-order mark. The finding points to line 1 for an unreadable manifest and the bin declaration for a missing command.

These notices have `actionable: false` and do not count toward the findings total.

| Notice code | Message |
|---|---|
| `package-entry-not-built` | `package.json <field> entry <entry>: not built yet, cannot confirm.` |
| `file-not-checked` | `<subject> was not checked because the scan was incomplete or the path could not be verified.` |
| `import-not-checked` | `Could not check relative import <specifier> in <file>.` |
| `broken-import-limit` | `Showing 24 broken relative imports. More exist.` |
| `binary-source-skipped` | `Skipped <file> because it looks binary.` |

`<field>` is `main` or `bin`. The possible subjects are `Root README.md`, `Dependency lockfile`, `Source service worker`, `package.json main entry <entry>` and `package.json bin entry <entry>`. The overflow notice requires at least 25 broken imports. A binary-looking package.json can produce both a skipped-file notice and a finding about its encoding.

Each audit allows 1,024 additional directory listings and link-target reads for name checks. Cached results remain available after the budget runs out. A lookup that still requires disk access is reported as unchecked. External relative imports use names and file types only. An external link whose target would need inspection also gets an unchecked notice.


### Project rules and notices added in 0.5.0

| Code | Where it appears | Exact message template |
|---|---|---|
| `code-coverage` | Notice in every report | `Code rules examined <n> JavaScript/TypeScript file(s). Other languages seen but not examined: <languages or none>.` |
| `code-not-examined` | Low coverage finding, recommendation | `<languages> code was not examined.` |
| `nested-packages-not-judged` | Notice | `Nested packages were not judged: <paths>.` |
| `folders-not-judged` | Notice | `Code rules excluded <n> folder(s): <paths>.` |
| `git-ignored-folders` | Notice | `Git ignore rules excluded <n> folder(s): <paths>.` |
| `package-not-examined` | Low coverage finding, recommendation | `The root package.json was not examined because <reason>.` |

Use the singular noun for one and plural for every other count. Paths and languages use fixed code-unit order, separated by a comma and a space. The two package processing reasons are `its nesting exceeds 256 levels` and `its metadata could not be processed`. Syntax errors in ordinary JSON retain the parser diagnostic. All four new notices carry `actionable: false`. They add no findings. The coverage notice includes recognized markup, stylesheet and component formats. The coverage finding lists only recognized programming languages, and only when zero files received JavaScript/TypeScript checks. The missing-README rule applies independently.

For several protected files, `secret-files-present` keeps the first path as its evidence location and appends the sorted paths to its verification instruction. The time bound covers collection and rules. A time stop uses the existing `scan-limit` message. The scanner suppresses missing-file findings on a time stop. The manifest check also suppresses a missing verdict when traversal was incomplete.
