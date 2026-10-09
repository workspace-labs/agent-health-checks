# Stack checks and verified follow-up

## Contents

- Safe static coverage
- Stack adapters
- Confidence rules
- Verified checks

## Safe static coverage

The bundled scanner reads bounded source and configuration text only. It checks project-root availability, malformed package metadata, declared entry points, relative JavaScript and TypeScript imports, risky Electron security settings, large source/assets, test-script presence, lockfile hygiene, debug residue, empty catch blocks, and TODO/FIXME concentration. Generated folders, dependencies, caches, binaries, secret files, and symlinks are skipped. Escaping links are refused; unresolved links remain visible in scan boundaries and findings with only a safe operating-system error code such as `ENOENT`.

Workspace bookkeeping folders are excluded by exact directory name before files enter any downstream check: `.proof`, `.proof-pipeline`, `.backup-pipeline`, `.backup-install`, and `.trash`. Every encountered folder remains visible as a non-actionable scan-boundary notice with its relative path and artifact classification; the scanner neither walks its contents nor charges them against the normal evidence budget.

Workspace bookkeeping **files** are excluded at the same boundary: a basename matching `*.bak` or
`*.bak-*` (the project's own gitignore shapes for editor and tool backups) is disclosed as a
non-actionable `workspace-editor-backup` scan-boundary notice and is not read as shipped project
source, so it consumes neither the file count nor the byte budget. The file-size bound is unchanged
and oversized real source remains actionable; lookalike names such as `backup.js` and `notes.bakup`
are still scanned, and a secret-shaped backup name such as `.env.bak` is still reported as
secret-like without reading its value.

Relative-import checks use the bounded file index first, then exact in-root filesystem metadata when a valid target may fall beyond a file, byte, or time bound. The fallback reads no target content, preserves filename-case checks on case-insensitive filesystems, and refuses symlink targets or parent paths that escape the explicit project root. A missing target remains a Confirmed finding even when the wider scan is incomplete. Nested `.backup-install` dependency caches are skipped so temporary package trees do not consume the project budget.

TypeScript `.ts`, `.tsx`, `.mts`, and `.cts` sources may import emitted JavaScript paths:
`.js`/`.jsx` resolve to `.ts`, `.tsx`, or `.d.ts`, `.mjs` to `.mts` or `.d.mts`, and `.cjs`
to `.cts` or `.d.cts`. Plain JavaScript imports cannot be satisfied by a lone TypeScript file.
Every directory segment and the target filename must match case, including on macOS.

Project metadata proves additional artifact boundaries before traversal: an Electron dependency
plus `build.directories.output`; a TypeScript dependency plus a test command's explicit `tsc
--outDir`; matching source/native Capacitor app IDs for Android's `.gradle` and generated web
assets; and a `.tablet-backup/<snapshot>` summary naming the app, a timestamp, copy metadata,
and a real APK or extracted-data folder. Unsafe paths, source folders, and the declared app entry
are never excluded as build output. Missing, invalid, oversized, or linked metadata proves no
exclusion. Each verified exclusion is a non-actionable notice; unverified snapshots stay inspected.
Metadata is read as data, never executed, with a separate maximum of 64 KiB per file, 256 KiB
total, and 256 files, lowered by the corresponding caller limits. Exhaustion produces an actionable
coverage notice. The ordinary source byte count excludes these metadata reads.

In-project symlinks are notice-only; broken and escaping links remain actionable. Android APK/AAB
and TAR archives are recognized as binary, so they cannot raise an oversized-text warning; their
size still counts in large-file checks unless their artifact role is separately proven.

Files above 1 MiB remain actionable unless their role is proven by project evidence. Exact declared build icons, their matching iconset inputs, `-src` image masters with an optimized sibling explicitly listed in `build.files`, and ZIPs in an explicit `*-zips/` distribution folder with a matching unpacked source directory are disclosed as non-actionable scan-boundary notices. Names or extensions alone never earn the exemption, and the global threshold is unchanged.

A project keeps trees beside its source that are not the shipped product, and their sample code is not production evidence. Scratch mockups and their drivers (a `demos/` path segment) and a skill package's starter code (`skills-library/<skill>/templates/`) are excluded from the runtime source rules the same way `tests/` already is, so their `console.log`, empty catches, `eval`, broken relative imports, TODO markers, and Electron `webPreferences` samples raise no findings, and their assets over 1 MiB are disclosed as one non-actionable notice instead of a performance finding. Session leftovers (`tmp/`) are dropped at traversal beside `dist`, `build`, and `out`, so they consume no scan budget. The exclusions are narrow by construction: the segment must be exactly `demos`, so a root `demo-debug.js` is still ordinary source, and the template rule is anchored to a skill package, so an application's own `src/templates/app.js` still counts. The two sample trees stay in the project digest, so a change under `demos/` or a skill's `templates/` still moves it; `tmp/` is dropped before any file is collected, so it is deliberately outside the digest and a change there does not move it.

## Stack adapters

- **JavaScript / TypeScript / Node**: package metadata, entry points, relative imports, test scripts, lockfiles, debug residue, empty catch blocks, and risky dynamic execution. Explicit Node CLI entrypoints may use `console.log` for their human-facing output; executable `debugger` statements remain actionable there, while ordinary application modules retain `console.log` detection. Scratch demo trees and skill starter templates are excluded from these rules entirely; a shebang CLI still prints with `console.log`, and an ordinary application module still flags it.
- **React / Next.js**: JavaScript checks plus large client assets and plain image loading opportunities.
- **Electron**: JavaScript checks plus `nodeIntegration`, `contextIsolation`, `sandbox`, and `webSecurity` evidence.
- **PWA**: manifest and service-worker presence when package metadata advertises PWA tooling.
- **Generic**: README, oversized files, TODO/FIXME concentration, secret-file presence without reading values, and bounded-scan notices.

Adapters intentionally prefer a small explainable rule set over broad regex guessing. Extend the scanner only with a deterministic fixture proving the rule and its false-positive boundary.

For an Electron project, `console.log` in root `scripts/` is treated as tool output only when an
explicit, understood `build.files` allowlist excludes the file and it is not the app entry. These
occurrences are disclosed together in scan notices. Executable `debugger`, imports, security
patterns, and all other source checks still apply there; packaged scripts and ordinary source
retain console detection.

## Confidence rules

- **Confirmed** requires direct static proof of a broken declaration or reference.
- **Likely** requires concrete risky code or configuration but still needs runtime confirmation.
- **Recommendation** describes missing safeguards or optimization opportunities and must never be called a bug.

Severity and confidence are independent. A high-severity recommendation can matter greatly without being a confirmed defect.

## Verified checks

Tests, lint, builds, audits, and profiling may create caches or artifacts even when source files stay unchanged. Show the exact command and obtain human approval first. Prefer existing scripts already declared by the project. Record the command, exit status, relevant output, duration when useful, and any generated artifacts. Do not install missing dependencies during diagnosis unless the human separately approves installation.
