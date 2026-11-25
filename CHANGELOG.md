# Changelog

## [0.5.0] - 2026-11-26

- Every project report counts distinct JavaScript and TypeScript files reached by source rules. A project with only recognized unsupported source, such as Python or Go, now gets a low coverage finding and Watch. A mixed project receives a notice. Clean JavaScript still reports Healthy. The generic adapter documentation now limits TODO counting to the JavaScript and TypeScript source rules.
- Reports name nested package manifests that did not receive project-level checks. A counted notice lists dependency folders, tool caches, root outputs and sample trees excluded by name. Root `vendor/` and sample `demos/` stay out of production checks. Hand-written code in nested folders such as `src/build/` now gets checked.
- Real Electron options can use quoted keys or assignments. Warning comments and strings no longer trigger risky-setting findings. The sandbox warning requires evidence linking the option to window preferences. A standalone manifest no longer triggers a missing worker. Projects with PWA tooling recognize `manifest.webmanifest` and `site.webmanifest`.
- Configuration templates ending in .example, .sample, .template or .dist no longer produce secret-file findings. Credential and keystore names added to the protection list are flagged without reading their contents. A finding for several protected files lists all their paths. Actual environment files and possible private keys retain their findings. Bare eval and Function construction remain detectable. Comments, string examples and method calls such as page.$eval no longer raise the dynamic-code finding.
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
