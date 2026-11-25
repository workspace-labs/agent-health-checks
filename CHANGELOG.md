# Changelog

## [0.2.0] - 2026-11-25

- Both checkers print their release with `--version` and include `checkerVersion` in JSON reports so readers can identify the copy that produced a scan.
- Document the two report formats and test their existing fields, findings, and exit codes so consumers can detect compatibility changes.
- Correct the install, update, and scan instructions. Explain which languages the project checker examines, how it handles ignored files, and what each report can tell its reader.
- Run the portable `node --test` command in a GitHub Actions matrix for macOS, Ubuntu, and Windows on Node 20, 22, and 24.
