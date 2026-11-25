# Changelog

## [0.3.0] - 2026-11-25

- The project checker no longer reports import text in comments, strings and templates as a confirmed broken import. It still checks imports inside template expressions.
- The reader recognizes React tags, fragments, quoted attributes and embedded JavaScript. Real missing imports inside expressions and after JSX or TSX markup keep their original file and line.
- Ambiguous syntax can still produce a false alarm. For example, a component with explicit type arguments, an unmatched closing tag or a slash that could mean division can make the reader keep all candidate findings from that point to the end of the file. This preserves evidence of real missing imports.

## [0.2.0] - 2026-11-25

- Both checkers print their release with `--version` and include `checkerVersion` in JSON reports so readers can identify the copy that produced a scan.
- Document the two report formats and test their existing fields, findings, and exit codes so consumers can detect compatibility changes.
- Correct the install, update, and scan instructions. Explain which languages the project checker examines, how it handles ignored files, and what each report can tell its reader.
- Run the portable `node --test` command in a GitHub Actions matrix for macOS, Ubuntu, and Windows on Node 20, 22, and 24.
