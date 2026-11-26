# Changelog

## [0.11.0] - 2026-11-26

- Skills Checker lists description pairs only when they share job words. It recognizes files named directly in the skill guide, including filenames written in ordinary text, so those files no longer receive an indirect-reference warning.
- Quoted YAML values can wrap onto indented lines. An unclosed quote now gives “frontmatter is not valid YAML”, marks the skill Broken and exits 2. In 0.10.0 an otherwise clean skill with this error received “frontmatter could not be verified”, Needs review and exit 0.
- Project Checker recognizes five additional ways JavaScript can call or take a reference to global eval. A ZIP-format presentation named `*.key` gets a document notice. The checker reads only the first four bytes for that format check. Other key contents stay protected.
- Each Windows CI job now tries the published PowerShell install commands in a temporary home and verifies that a second install preserves both existing copies.

## [0.10.0] - 2026-11-26

- The printed reports, guides and agent cards now use the names **Skills Checker** and **Project Checker** so readers can follow one name from installation to results. The Skills Checker failure line uses its new name too.
- The Skills Checker now keeps file collection, rules and report formatting in separate modules. Its public entry point, result fields, verdicts and rule messages retain their existing contracts.
- New tests pin all ten verdicts and their counts, check the read-only boundaries of both commands and verify that a scan leaves an executable fixture untouched. Test fixtures now clean up their temporary folders.
- The README shows dated sample output and safe manual installation steps. The guides explain how to report the evidence and its limits. The repository now documents its scope, release process and rule-testing decisions.

## [0.9.0] - 2026-11-26

- The default skills scan lists other installed locations under **Not checked**, counts filenames without opening skill files there, and marks incomplete counts. Hidden regular files no longer appear in `notSearched`. Only requested roots receive verdicts.
- Long-reference contents advice now checks Markdown documents over 100 lines for a contents heading or bold label in the first 30 lines. The `deep-reference` finding now says `Reference is reachable only through another reference: <file>`. It follows links from the guide so that directly linked files can live in nested folders.
- Portability notes cover documented tool and hook identifiers in the instructions, interface YAML and Markdown references. A declared compatible product covers its identifiers. References to a product by name and ordinary filenames in prose previously produced unnecessary warnings. Missing bundled references retain their structural findings.
- Removed the `trigger-overlap` finding and its status effect before 1.0.0. **Closest descriptions** ranks up to five pairs for human review. The terminal also shows the character totals for the observed Claude and Codex installations and their estimated listing budgets.
- A completed skills scan now exits 2 for an open `destructive-command`, `code-execution` or `network-access` finding as well as a Broken skill. Explicit roots containing zero skills now exit 1. Clean scans and scans with other review findings still exit 0. Invalid usage, an unavailable explicit root and failures exit 1. Help and version exit 0.
- The default skills CLI JSON omits bodies and frontmatter values to keep the report small. It keeps their UTF-8 byte counts and the original digest. Use `--json --include-body` for complete values. The module still returns both for the Workspace Skills page.
- Both skill descriptions specify the static read-only checks and their limits. The skills guide and README now show how to compare a candidate with installed skills before installation.

### Existing test expectations changed in 0.9.0

The names below identify the tests as published in 0.8.0.

| Existing test | Reason for the change |
|---|---|
| `root header and JSON name hidden entries while visible container skills are audited` | K1 removes the regular file `.DS_Store` from the hidden-folder list. |
| `skill findings retain their reference, safety and agent profile messages` | K2 adds a genuine indirect link and pins its new message. All other messages retain their expectations. |
| `terminal leads with safety, groups repeat codes, prints advice, and counts omitted findings` | K2 uses a genuinely indirect link to preserve the terminal fixture's 20 findings. |
| `a caller's build command receives review in SKILL.md` | K4 drops the caller's bare build command. |
| `agents/openai.yaml distinguishes conventional asset paths from other icon paths` | K4 supplies an existing icons folder for the unresolved icon control. |
| `absolute and home links and uncertain relative file references receive an exact review note` | K4 keeps actual links and drops the text operand in an absent folder. |
| `an ambiguous instruction operand is a reference while descriptions of another project's layout are examples` | K4 drops the text operand in an absent folder. |
| `operative absolute and home paths receive review while descriptive install locations stay quiet` | K4 keeps explicit Markdown links and drops the bare host paths. |
| `bare instruction filenames and non-Latin bundled folders include their missing and existing controls` | K4 drops bare filenames and retains the missing file under a real bundled folder. |
| `different duplicates and likely trigger overlap remain visible` | K5 preserves duplicate-name findings and checks job overlap in the summary. |
| `skill findings retain their duplicate-name and trigger-overlap messages` | K5 removes the overlap message and still pins the duplicate-name message. |
| `published skill commands run the bundled checkers from either working directory` | K9 executes the fourth documented command and checks its candidate and collection. |

## [0.8.0] - 2026-11-26

- Project CLI exit codes now distinguish Healthy or Watch (0), Needs attention (2) and Unavailable or incorrect usage (1). Omitting `--path` previously exited 2. Unknown options, missing values and invalid limits are reported. Each value option can appear once, using a space or an equals sign, and four limits can be set from the CLI.
- The checker refuses the home folder, its ancestors and filesystem roots through the CLI and module. Unavailable findings now say “The checker cannot inspect or verify this folder.” and “Check that --path names an existing folder you can read.” This changes their finding IDs. The audit guide uses general review language.
- Workspace layout exclusions are opt-in through `--profile workspace` or the module's `profile` option. The default checks those paths as ordinary content.
- The checker reads the root `package.json` first so source files cannot exhaust the text budget before the entry, bin and test checks. Runtime JavaScript and TypeScript come next. A medium coverage finding identifies eligible sources missed by a limit. Links consume file slots. Size skips, binaries and broken links are reported as notices. Single-path notices share a count and up to ten examples. The terminal groups findings and keeps high findings and unread source visible.
- Repeating the same unresolved import on one line now produces one finding. The dynamic-code check recognizes bracket access and optional calls to global eval.

### Existing test expectations changed in 0.8.0

**CLI status and diagnostics.** These four tests now expect exit 2 when a completed project report needs attention. Their evidence, locale and terminal-escaping checks still apply.

- `published skill commands run the bundled checkers from either working directory`
- `project evidence retains its field names, severity, confidence, wording, digest and IDs`
- `Czech and Estonian audits use the same code-unit order and finding IDs`
- `project terminal preserves each report line and JSON preserves names, paths and quoted references`

The former `project CLI returns zero for Healthy, Watch and Unavailable, and two when the path is omitted` now checks exit 1 for an unavailable or omitted path, the two-line usage diagnostic, and the revised unavailable finding and its ID.

**Workspace profile.** The following tests now select the profile explicitly to exercise the owner's layout and its lookalike controls.

- `mixed languages get one notice and no finding; source tests and samples do not count`
- `demos, skill templates, caches and nested dependencies are named together`
- `a byte stop keeps observed names for ignored, sample and skipped folders`
- `generated backup installs do not consume the project scan budget`
- `a backed-up secret file is still disclosed as secret-like, not silenced as a backup`
- `scratch demo trees raise no runtime-source or large-file findings`
- `skill starter templates raise no runtime-source or large-file findings`
- ``A `tmp/` directory is dropped before file collection, so changing a file there leaves both the file count and digest unchanged``
- `close lookalikes outside the exclusions stay fully actionable`
- `many backup summaries cannot bypass the cumulative metadata read limit`
- `proven tablet snapshots are disclosed and excluded without hiding loose backup-folder source`
- `tablet snapshot with <condition> remains inspected` for `missing timestamp`, `invalid timestamp`, `wrong app` and `missing copy metadata`
- `tablet metadata without a real apk or extracted directory does not hide source`
- `tablet <mode> metadata cannot exclude the snapshot` for `oversized` and `symlinked`

Three more profile tests now verify a single counted notice for the excluded paths. These are `Workspace artifact folders are disclosed and excluded before every downstream check`, `Workspace editor backup files are disclosed and excluded before every downstream check`, and `skipped editor backups consume no scan budget and never hide ordinary source`. The profile test `editor-backup lookalikes stay scanned and ordinary oversized source stays actionable` now checks the oversized JSON path in its notice.

**Unread source.** `a time stop during traversal cannot call an existing web manifest missing` now expects the unread source and the scan limit together. `an archive-looking source filename keeps the oversized-source warning` now verifies both the size notice and the unread JavaScript finding.

**Size, binary and link notices.** These tests now verify the path and reason on the notice or its counted group.

- `file count, text size and metadata limits keep their exact finding messages` checks the previous size wording on a single file's notice.
- `escaping and unresolved links retain their exact finding messages` and `broken project symlinks are disclosed with a safe resolution code` check the unresolved-link notice and its resolution code. The escaping-link finding keeps its wording.
- `proven Capacitor generated assets and cache consume no budget while native source stays inspected` now locates the oversized native file in the notices.
- `oversized reference data is notice-only while oversized source stays actionable` now checks the count and both classifications on one size notice.
- The former `an oversized manifest retains its coverage finding` now checks its size notice. The former `binary source and manifest files are named, images and fonts are quiet` now counts the binary sources, manifests, images and fonts in one notice and still checks the source coverage.
- `declared build and distribution assets stay visible without inflating large-file findings` and `declared packaging-excluded human deliverables stay visible without hiding ordinary large files` now expect one notice with its count and examples.
- `absent <output> is unbuilt, but an existing output with a missing entry is confirmed` for `build`, `out` and `dist` now checks a counted notice covering both entry declarations.
- `entry declarations outside the root are reported as unchecked` and `links to external files and output directories cannot confirm missing main or bin` now verify both paths on one notice.

**Test instrumentation.** The following tests now observe file opens as well as reads made directly by path, so their existing read-boundary assertions cover the new bounded reader.

- `all protected regular files stay unread and the finding identifies every path`
- `relative imports outside the scan use exact names without reading target contents`
- `EACCES names the manifest read failure without claiming malformed JSON` and its `EIO` counterpart
- `nested packages are named once, including unreadable and oversized manifests`
- `the metadata reader never opens files beneath a Git-ignored Android folder`
- `a deadline spent listing the root prevents later metadata reads`
- `file contents can be unreadable while README, lockfile, entry and worker names are still verified`
- `unreadable project files and directories retain their exact finding messages`

The temporary projects in `project-doctor.test.js` now share a directory removed at the end of the suite.

## [0.7.0] - 2026-11-26

- A structural error still makes a skill Broken. Open safety evidence now produces Needs review even alongside a personal path or a finding in one product profile. A personal path on its own produces Workspace-specific.
- Wrapped descriptions and quoted colons pass. Malformed YAML, including duplicate keys, indentation tabs, stray lines and unquoted colon-space in plain values, reports the source line. Unverified syntax receives a review note. The same reader checks optional Codex metadata. A valid invocation policy passes without display metadata, and each entry in a tool dependency list is examined.
- Destructive operations, process execution and network calls in supported scripts or Markdown shell blocks now prompt review. Command spellings in prose or data files no longer produce those three safety findings.
- The existing `allowed-tools-extension` finding now says “The Agent Skills specification marks allowed-tools as experimental”. Extra top-level fields receive one attributed portability note. A compatibility value over 500 characters is Broken. Angle brackets produce a Claude upload warning with separate explanations for names and descriptions. Reserved-word checks match whole hyphen-separated words.
- Personal macOS, Linux and Windows paths now count in instructions, scripts and Codex metadata. A web address, shared or placeholder user, portable home path, relative Workspace path or data-table example no longer makes a skill Workspace-specific.
- The skills terminal leads with safety, groups repeated rule codes, prints advice and counts omitted findings. Both terminals escape embedded control characters and direction marks. Both standalone checkers report 0.7.0.

Existing tests adjusted for the corrected cases:

1. `skills report emits all six status keys, labels, axis grades and finding severities` uses `/Users/alice/maps` for Workspace-specific and unused Codex metadata for Claude-ready. A separate case covers `~/Desktop/maps`.
2. `separate Claude and Codex profiles produce directional readiness` uses a default prompt missing its skill mention to exercise the Codex profile warning. A documented policy alone now passes.
3. `both metadata files are examined even with {"maxFiles":0}` and `both metadata files are examined even with {"maxTotalBytes":0}` use unused metadata to preserve the evidence that both files were read.
4. `code under dist receives the ordinary safety checks` and its `build`, `vendor` and `scripts` counterparts now expect execution as well as network access for their download piped into a shell.
5. `skill findings retain their frontmatter, name, length and trigger messages` now includes the fixture’s extra top-level field.
6. `skill findings retain their reference, safety and agent profile messages` pins the experimental-field wording, uses a named home and checks executable code in actual script files.

## [0.6.0] - 2026-11-26

- A skill installed through a top-level link into a scanned root now has one card with both locations. An escaping link names the unchecked target in a structure finding. Neither link can manufacture a duplicate-name warning.
- A collection discovers skills through three directory levels. Containers report their names and skill counts, and a defect inside a nested skill appears on that skill's card. The terminal and optional JSON field `roots[].notSearched` name hidden entries skipped during discovery. A root containing its own instructions is scanned directly. Empty folders produce no card. A populated install missing its instructions still reports Broken.
- Instruction and interface metadata are read first. A large bundle and a reference to an existing file beyond the scan limit no longer cause a false Broken verdict. The report gives the number of unread files. Dependency and Python cache folders receive review findings with their counts. Git history stays outside the scan.
- Differences in build output and vendor files now distinguish installations. Executable-looking text there receives the same static checks as text in an ordinary scripts folder. Desktop metadata and CRLF versus LF in text no longer create duplicate skills. Digest ordering is fixed across locales.
- Identical copies keep the findings and worst status of their installations in either root order. Two physical copies with one name inside a root raise a duplicate-name finding even when their contents match.
- The terminal lists each root's state first. A missing or unreadable explicit root, a file used as a root, and an omitted root path exit 1. Path-like arguments containing an equals sign keep their full path. Missing default roots stay quiet.
- References in Markdown and the optional interface YAML are checked against case-exact names on disk. Punctuation, link titles, URL escapes and skill-directory prefixes are recognized. A missing internal Markdown link or a missing script, reference or asset named in the skill instructions or interface YAML reports Broken. Unresolved project commands, links leaving the skill and references in other Markdown files now receive review findings.
- Project Checker reports the same release number. Its scan behavior is unchanged.

Existing contract tests changed as follows.

1. `skill findings retain their frontmatter, name, length and trigger messages` uses a populated folder for the missing-instructions message. An empty folder is ignored.
2. `skills scan forwards exact size, budget and unreadable-path messages to findings` expects unread counts for both kinds of limit. A zero file budget still reads the instructions.
3. `skills scan retains each distinct message for nested and root symlinks` pins the approved `symlink-root-escape` wording, including the unchecked target.
4. `skills JSON preserves finding identity across identical installations` pins the new root state and the digest in code-unit order.
5. `skills report emits all six status keys, labels, axis grades and finding severities` supplies a draft file in the unfinished installation so it exercises Broken.
6. `skills CLI exits 0 for a completed review, 2 for Broken, and 1 on argument failure` uses the same populated unfinished-install case for exit 2.
7. `skill findings retain their reference, safety and agent profile messages` expects the review finding `unverified-reference` for the link leaving the skill.

The fix round also updates eight inventory and reference tests introduced on this branch:

- `hidden skill containers are listed as not searched and deep empty branches supply no Broken card` now checks disclosure of the skipped container.
- `conventional missing paths in code and prose are Broken while other bundle folders receive review`, `skill-directory variables identify root-level files in prose without an action verb`, and `bare instruction filenames and non-Latin bundled folders include their missing and existing controls` now expect review for text outside the three conventional folders.
- `nested Markdown links use their document directory while bundle paths and YAML icons use the skill root` and `nested instructions accept present files under either working directory and retain document-relative link semantics` now expect review for unresolved links in secondary documents or a nonstandard YAML icon path.
- `absolute and home links and uncertain relative file references receive an exact review note` now expects the same review code for an escaping relative link. `Markdown HTML images and anchors name local destinations, including root files, and fenced markup is an example` expects review for HTML targets outside the conventional folders.

## [0.5.0] - 2026-11-26

- Every project report counts distinct JavaScript and TypeScript files reached by source rules. A project with only recognized unsupported source, such as Python or Go, now gets a low coverage finding and Watch. A mixed project receives a notice. HTML and CSS appear in the coverage notice only. A plain static site reports Healthy with a README and Watch for the missing README without one. Clean JavaScript still reports Healthy. The generic adapter documentation now limits TODO counting to the JavaScript and TypeScript source rules.
- Reports name nested package manifests that did not receive project-level checks. A counted notice lists dependency folders, tool caches, root outputs and sample trees excluded by name. Root `vendor/` and sample `demos/` stay out of production checks. Hand-written code in nested folders such as `src/build/` now gets checked.
- Real Electron options can use quoted keys or assignments. Warning comments and strings no longer trigger risky-setting findings. The sandbox warning requires evidence linking the option to window preferences. A standalone manifest no longer triggers a missing worker. Projects with PWA tooling recognize `manifest.webmanifest` and `site.webmanifest`.
- Configuration templates ending in .example, .sample, .template or .dist no longer produce secret-file findings. Credential and keystore names added to the protection list are flagged without reading their contents. A finding for several protected files lists all their paths. Actual environment files and possible private keys retain their findings. Dynamic-code checks recognize bare eval, eval calls on `window`, `globalThis`, `self` and `global`, the indirect `(0, eval)(...)` form, and Function construction. Comments, string examples and method calls such as page.$eval no longer raise the dynamic-code finding.
- Root Git ignore and local Git exclude files can declare literal root folders. Each applied directory is named. Negation disables exclusions from its own file. The scanner never invokes Git.
- More README spellings and npm shrinkwrap count. A real test command may end in `|| exit 1`. Console output from a declared or identifiable command-line entry no longer counts toward debug residue. Application logging and executable debugger statements retain their checks.
- Project Checker uses fixed UTF-16 code-unit order for paths. Desktop metadata files no longer affect counts or fingerprints. A language change no longer reorders findings.
- Source patterns finish in bounded passes on long padded inputs. One deadline covers collection and rules. `durationMs` now measures elapsed time for the whole audit, including rules and report preparation. A time stop gets a notice and suppresses missing-file verdicts. **Additional 0.4.0 defect** — the PWA checker could call an existing manifest missing after an incomplete traversal. Deep or unexpectedly unreadable package metadata now produces a plain report diagnostic.
- Eight existing test cases had fixtures affected by these changes. `project findings keep the exact package, import, Electron, PWA and source messages` now uses live Electron settings so its original wording assertions still exercise real findings. `Workspace artifact folders are disclosed and excluded before every downstream check` counts the grouped folder notice and the coverage notice. `binary source and manifest files are named, images and fonts are quiet`, `the same source in plain UTF-8 is checked`, and `a UTF-16 source BOM discloses a skipped file even when no byte is zero` now include their examined-file count. The three instances of `show the first 24 of <n> broken imports and disclose actual overflow` (24, 25 and 31) include the same coverage notice alongside the original overflow assertions.

## [0.4.0] - 2026-11-26

- Project Checker now finds a declared startup file in build output, with an omitted extension, or through a directory index. It checks string and named `bin` entries the same way. An absent build-output folder gets a notice that the project may need building. A genuinely missing entry in a checked location is still high and confirmed. Package fields `exports`, `module`, `types` and `browser` are deferred.
- Root files and the root `src` folder are read before other folders. A large picture collection can still reach the scan limit, but the report can now identify the package, inspect its source and find its README. The checker verifies README, lockfile, entry and service-worker names on disk before reporting an absence. An incomplete check gets a notice. An unlistable project root reports Unavailable.
- TypeScript imports can resolve declaration-only files. Relative imports can resolve a directory's package entry, an internal link or a native Node addon. For a path above the scan root, the checker uses file metadata only. It consults directory manifests already read within the scan budget and discloses an import it could not verify.
- Side-effect imports (including CSS), `require.resolve`, literal backtick arguments and comments before dynamic import paths now receive missing-file checks. Quoted examples and comments stay quiet under the existing source reader. Runtime concatenation and template interpolation no longer trigger findings for partial paths. The first 24 real broken imports are shown, with an overflow notice when a 25th exists.
- A single leading UTF-8 byte-order mark is accepted in package.json. An empty manifest, UTF-16 manifest, or manifest containing zero bytes or invalid UTF-8 gets a confirmed finding naming the reason. An operating-system read failure names the access problem. Malformed JSON in ordinary UTF-8 keeps its existing parser diagnostic. Binary-looking source files and manifests are named in notices. Images and fonts remain quiet.
- All Step 1 and Step 2 pinned tests are unchanged.

## [0.3.0] - 2026-11-25

- Project Checker no longer reports import text in comments, strings and templates as a confirmed broken import. It still checks imports inside template expressions.
- The reader recognizes React tags, fragments, quoted attributes and embedded JavaScript. Real missing imports inside expressions and after JSX or TSX markup keep their original file and line.
- Ambiguous syntax can still produce a false alarm. For example, a component with explicit type arguments, an unmatched closing tag or a slash that could mean division can make the reader keep all candidate findings from that point to the end of the file. This preserves evidence of real missing imports.

## [0.2.0] - 2026-11-25

- Both checkers print their release with `--version` and include `checkerVersion` in JSON reports so readers can identify the copy that produced a scan.
- Document the two report formats and test their existing fields, findings, and exit codes so consumers can detect compatibility changes.
- Correct the install, update, and scan instructions. Explain which languages Project Checker examines, how it handles ignored files, and what each report can tell its reader.
- Run the portable `node --test` command in a GitHub Actions matrix for macOS, Ubuntu, and Windows on Node 20, 22, and 24.
