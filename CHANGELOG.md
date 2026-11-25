# Changelog

## [0.6.0] - 2026-11-26

- A skill installed through a top-level link into a scanned root now has one card with both locations. An escaping link names the unchecked target in a structure finding. Neither link can manufacture a duplicate-name warning.
- A collection discovers skills through three directory levels. Containers report their names and skill counts, and a defect inside a nested skill appears on that skill's card. The terminal and optional JSON field `roots[].notSearched` name hidden entries skipped during discovery. A root containing its own instructions is scanned directly. Empty folders produce no card. A populated install missing its instructions still reports Broken.
- Instruction and interface metadata are read first. A large bundle and a reference to an existing file beyond the scan limit no longer cause a false Broken verdict. The report gives the number of unread files. Dependency and Python cache folders receive review findings with their counts. Git history stays outside the scan.
- Differences in build output and vendor files now distinguish installations. Executable-looking text there receives the same static checks as text in an ordinary scripts folder. Desktop metadata and CRLF versus LF in text no longer create duplicate skills. Digest ordering is fixed across locales.
- Identical copies keep the findings and worst status of their installations in either root order. Two physical copies with one name inside a root raise a duplicate-name finding even when their contents match.
- The terminal lists each root's state first. A missing or unreadable explicit root, a file used as a root, and an omitted root path exit 1. Path-like arguments containing an equals sign keep their full path. Missing default roots stay quiet.
- References in Markdown and the optional interface YAML are checked against case-exact names on disk. Punctuation, link titles, URL escapes and skill-directory prefixes are recognized. A missing internal Markdown link or a missing script, reference or asset named in the skill instructions or interface YAML reports Broken. Unresolved project commands, links leaving the skill and references in other Markdown files now receive review findings.
- The project checker reports the same release number. Its scan behavior is unchanged.

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
- The project checker uses fixed UTF-16 code-unit order for paths. Desktop metadata files no longer affect counts or fingerprints. A language change no longer reorders findings.
- Source patterns finish in bounded passes on long padded inputs. One deadline covers collection and rules. `durationMs` now measures elapsed time for the whole audit, including rules and report preparation. A time stop gets a notice and suppresses missing-file verdicts. **Additional 0.4.0 defect** — the PWA checker could call an existing manifest missing after an incomplete traversal. Deep or unexpectedly unreadable package metadata now produces a plain report diagnostic.
- Eight existing test cases had fixtures affected by these changes. `project findings keep the exact package, import, Electron, PWA and source messages` now uses live Electron settings so its original wording assertions still exercise real findings. `Workspace artifact folders are disclosed and excluded before every downstream check` counts the grouped folder notice and the coverage notice. `binary source and manifest files are named, images and fonts are quiet`, `the same source in plain UTF-8 is checked`, and `a UTF-16 source BOM discloses a skipped file even when no byte is zero` now include their examined-file count. The three instances of `show the first 24 of <n> broken imports and disclose actual overflow` (24, 25 and 31) include the same coverage notice alongside the original overflow assertions.

## [0.4.0] - 2026-11-26

- The project checker now finds a declared startup file in build output, with an omitted extension, or through a directory index. It checks string and named `bin` entries the same way. An absent build-output folder gets a notice that the project may need building. A genuinely missing entry in a checked location is still high and confirmed. Package fields `exports`, `module`, `types` and `browser` are deferred.
- Root files and the root `src` folder are read before other folders. A large picture collection can still reach the scan limit, but the report can now identify the package, inspect its source and find its README. The checker verifies README, lockfile, entry and service-worker names on disk before reporting an absence. An incomplete check gets a notice. An unlistable project root reports Unavailable.
- TypeScript imports can resolve declaration-only files. Relative imports can resolve a directory's package entry, an internal link or a native Node addon. For a path above the scan root, the checker uses file metadata only. It consults directory manifests already read within the scan budget and discloses an import it could not verify.
- Side-effect imports (including CSS), `require.resolve`, literal backtick arguments and comments before dynamic import paths now receive missing-file checks. Quoted examples and comments stay quiet under the existing source reader. Runtime concatenation and template interpolation no longer trigger findings for partial paths. The first 24 real broken imports are shown, with an overflow notice when a 25th exists.
- A single leading UTF-8 byte-order mark is accepted in package.json. An empty manifest, UTF-16 manifest, or manifest containing zero bytes or invalid UTF-8 gets a confirmed finding naming the reason. An operating-system read failure names the access problem. Malformed JSON in ordinary UTF-8 keeps its existing parser diagnostic. Binary-looking source files and manifests are named in notices. Images and fonts remain quiet.
- All Step 1 and Step 2 pinned tests are unchanged.

## [0.3.0] - 2026-11-25

- The project checker no longer reports import text in comments, strings and templates as a confirmed broken import. It still checks imports inside template expressions.
- The reader recognizes React tags, fragments, quoted attributes and embedded JavaScript. Real missing imports inside expressions and after JSX or TSX markup keep their original file and line.
- Ambiguous syntax can still produce a false alarm. For example, a component with explicit type arguments, an unmatched closing tag or a slash that could mean division can make the reader keep all candidate findings from that point to the end of the file. This preserves evidence of real missing imports.

## [0.2.0] - 2026-11-25

- Both checkers print their release with `--version` and include `checkerVersion` in JSON reports so readers can identify the copy that produced a scan.
- Document the two report formats and test their existing fields, findings, and exit codes so consumers can detect compatibility changes.
- Correct the install, update, and scan instructions. Explain which languages the project checker examines, how it handles ignored files, and what each report can tell its reader.
- Run the portable `node --test` command in a GitHub Actions matrix for macOS, Ubuntu, and Windows on Node 20, 22, and 24.
