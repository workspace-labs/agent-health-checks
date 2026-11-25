# Changelog

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
