# JSON report formats

Pass `--json` to either checker. Both reports use `schemaVersion: 1` and identify the release in `checkerVersion`. A skills report groups findings by installed skill in `skills`. A project report has a top-level `findings` array.

## Skills report

| Top-level key | Meaning |
|---|---|
| `schemaVersion`, `checkerVersion` | Numeric schema version (`1`) and the checker release string. |
| `generatedAt` | UTC timestamp for this run in ISO 8601 format. |
| `readOnly`, `disclaimer` | The boolean `true` and the description of the scan's limits. |
| `roots` | Each requested root has `id`, `label`, `path`, `exists` and a `skills` count. An existing root that cannot be listed also carries `unreadable: true`. |
| `summary` | Counts of unique `skills`, identical `mirrors`, `findings`, and one count per key in `statuses`. |
| `skills` | Array of unique skills. Identical copies with the same name and digest share an entry. |

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

Finding identity also includes the enclosing skill's **digest and list of install locations**. Each entry in `sources` contains the root's `id`, `label` and displayed `root`, the installed folder's `path` and the `skillMd` path. Home-relative paths display with a leading `~`. The list preserves root traversal order. Skills findings do not carry a separate finding ID or confidence level.

The skill's `id` joins its name and digest with a colon. The digest is 64 lowercase hexadecimal characters. For an ordinary skill, sort the scanned files by relative path using `localeCompare`. For each file, hash its bytes with SHA-256 (or use `oversized:<size>` for an oversized entry). Feed the relative path, a NUL byte, the hex hash or oversized marker, and a final NUL byte into the outer SHA-256. File order can vary with the locale. For a refused root symlink, the hash input consists of the following NUL-separated values in order. It starts with the literal `skill-symlink-refusal`, rule code, entry name, displayed root, displayed link path, and either the resolution error code or the displayed resolved path.

A completed skills scan exits **0** if no skill is Broken and **2** if at least one is Broken. Both can produce a complete JSON report. A caught failure, including an unknown option, exits **1**. Help and version requests exit **0**.

The CommonJS module exports the functions `auditSkillRoots`, `parseFrontmatter` and `overlapScore`, plus `AXES` and `DEFAULT_LIMITS`. The functions return their results synchronously.

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
| `fileCount`, `totalBytes`, `durationMs`, `disclaimer` | Collected file count, bytes counted by the scan, collection time in milliseconds and a static-analysis disclaimer. |

Status keys and labels are `healthy` (Healthy), `watch` (Watch), `attention` (Needs attention) and `unavailable` (Unavailable). A confirmed or high/critical finding produces Needs attention. Other findings produce Watch. An accessible project with zero findings reports Healthy.

Each finding has `code`, `category`, `severity`, `confidence`, `message`, `file`, `line`, `impact`, `verify`, `recommendation` and `id`. Severity ranks are `critical`, `high`, `medium` and `low`. The current rules emit the latter three. Confidence values are `confirmed`, `likely` and `recommendation`. The file is a project-relative path with forward slashes, or `.` for project-level evidence. Lines begin at 1. A counted finding can point only to its first example.

**Identity.** Resolve a project finding using the report's `digest` together with its finding `id`. The ID is the first 24 lowercase hex characters of SHA-256 over the UTF-8 JSON object containing `reportDigest` followed by the ten finding fields listed above in order, ending with `recommendation`. This makes the rule code, exact message, location and all other finding text significant. Project findings have no axis or list of install locations.

The report digest hashes the collected relative paths paired with their file digests, sorted by `localeCompare` on the paths. A NUL separates each path and digest and each pair. Read file bytes contribute a SHA-256 hex digest. Recognized binary extensions, protected names and oversized files contribute size markers such as `binary:3`, `secret:4` and `oversized:5`. An empty collection hashes `empty:<real root>`. An unavailable root hashes `unavailable:<requested absolute path>:<error message>`. Locale can affect ordering, and an unavailable digest depends on the path and error text.

**CLI.** A completed report exits 0 for every status, including Needs attention and Unavailable. Omitting the required path exits 2. Standalone help and version requests exit 0.

**CommonJS exports.** `auditProject`, `collectProject`, `humanReport`, `isIntentionalReferenceData` and `resolveFinding` are synchronous functions. The module also exports the `DEFAULT_LIMITS` object. A successful `resolveFinding(report, { digest, findingId })` returns `{ report, finding }`. An unmatched digest or ID returns `null`.
