# Project Checker stack checks and verified follow-up

## Contents

- Safe static coverage
- Optional profile: workspace
- Stack adapters
- Confidence rules
- Verified checks

## Safe static coverage

Project Checker reads bounded source and configuration text. The rules below describe what this checker inspects. It checks project-root availability, malformed package metadata, declared entry points, relative JavaScript and TypeScript imports, risky Electron security settings, large source/assets, test-script presence, lockfile hygiene, debug residue, empty catch blocks, and TODO/FIXME concentration. Generated folders, dependencies, caches, binaries, secret files, and symlinks are skipped. Escaping links are refused; unresolved links remain visible in scan boundaries with a safe operating-system error code such as `ENOENT` for individual links.

Relative-import checks use the bounded file index first, then exact in-root filesystem metadata when a valid target may fall beyond a file or byte bound. The fallback reads no target content, preserves filename-case checks on case-insensitive filesystems, and refuses symlink targets or parent paths that escape the explicit project root. A verified absence can still be confirmed after a file or byte limit. Expiry of the whole-audit time budget stops further checks and suppresses missing-file findings.

TypeScript can resolve an emitted JavaScript import to its corresponding source or declaration. Checked 2026-11-26 against the [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html#file-extension-substitution).

For TypeScript importers, Project Checker looks for `.ts`, `.tsx` and `.d.ts` alternatives to `.js` or `.jsx`. It checks `.mts` and `.d.mts` for `.mjs`, and `.cts` and `.d.cts` for `.cjs`. For a JavaScript importer it requires a JavaScript target when the import names one. The checker requires matching case in every path segment on every platform.

Project metadata proves additional artifact boundaries before traversal: an Electron dependency
plus `build.directories.output`; a TypeScript dependency plus a test command's explicit `tsc
--outDir`; matching source/native Capacitor app IDs for Android's `.gradle` and generated web
assets. These rules use documented project settings. Checked 2026-11-26 against [electron-builder directories](https://www.electron.build/docs/api/app-builder-lib.interface.configuration/#directories), the [TypeScript output directory](https://www.typescriptlang.org/tsconfig/outDir.html) and [Capacitor configuration](https://capacitorjs.com/docs/config).

Unsafe paths, source folders, and the declared app entry
are never excluded as build output. Missing, invalid, oversized, or linked metadata proves no
exclusion. Each verified exclusion is a non-actionable notice.
Metadata is read as data, never executed, with a separate maximum of 64 KiB per file, 256 KiB
total, and 256 files, lowered by the corresponding caller limits. Exhaustion produces an actionable
coverage notice. The ordinary source byte count excludes these metadata reads.

In-project and unresolved symlinks appear in notices. Escaping links also produce findings. Android APK/AAB
and TAR archives are recognized as binary, so they cannot raise an oversized-text warning; their
size still counts in large-file checks unless their artifact role is separately proven.

Files above 1 MiB remain actionable unless their role is proven by project evidence. Exact declared build icons, their matching iconset inputs, `-src` image masters with an optimized sibling explicitly listed in `build.files`, and ZIPs in an explicit `*-zips/` distribution folder with a matching unpacked source directory are disclosed as non-actionable scan-boundary notices. Names or extensions alone never earn the exemption, and the global threshold is unchanged.

Projects can declare human-facing deliverables in `package.json`. The configuration key `projectDoctor` keeps its original spelling for compatibility with existing consumers. Set `projectDoctor.intentionalLargeAssets` to an array of objects such as `{"path":"docs/guide.pdf","kind":"human-deliverable"}`. The path must name an exact in-project file, and an explicit package build allowlist must exclude it. This rule applies in every profile.

The coverage notice counts distinct runtime files reached by the JavaScript and TypeScript rules. Other recognized languages appear by name. Nested packages are listed together because only the root package receives project-level checks. Dependency and tool-cache names apply at any depth. The output names `dist`, `build`, `out`, `tmp`, `target`, `coverage` and `vendor` apply at the root. A nested output needs evidence from project settings. The grouped folder notice identifies encountered name-based exclusions and any sample trees excluded by the selected profile.

Git documents both repository ignore files and local exclusions, including negation patterns. Checked 2026-11-26 against [Git’s ignore-file reference](https://git-scm.com/docs/gitignore). Project Checker accepts literal root-folder exclusions with an optional leading slash. A negation disables that file’s exclusions in the checker. Operating-system metadata files are omitted. See the protected-name list in the skill guide for credential handling.

## Optional profile: workspace

The profile is off by default. Pass `--profile workspace` on the command line or `profile: "workspace"` to the module to apply the owner's app layout. The default treats the following names as ordinary project content.

- The profile skips `.backup-install`, `.backup-pipeline`, `.proof`, `.proof-pipeline`, `.trash` and `.pipeline` at any depth. It also skips files named `*.bak` or `*.bak-*`. Protected names such as `.env.bak` retain their secret-file handling.
- Paths with an exact `demos/` segment and `skills-library/<skill>/templates/` stay in the project digest. The source rules skip them. Their large assets receive the `non-production-large-asset` notice.
- A Capacitor project's `.tablet-backup/<snapshot>` is excluded only when its summary identifies the app and a valid timestamp, includes copy metadata, and has an APK or extracted-data directory. Unverified snapshots remain visible.
- The `projectDoctor.intentionalLargeAssets` declaration described above also works with this profile.

## Stack adapters

- **JavaScript / TypeScript / Node** checks cover package metadata, entry points, relative imports, test scripts, lockfiles, debug residue, empty catch blocks, and risky dynamic execution. Explicit Node CLI entrypoints may use `console.log` for their human-facing output; executable `debugger` statements remain actionable there, while ordinary application modules retain `console.log` detection. For the meanings of the manifest fields, see [npm’s package reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json), checked 2026-11-26.
- **React / Next.js** projects receive the JavaScript and TypeScript checks and the general large-file check.
- **Electron** checks cover JavaScript plus `nodeIntegration`, `contextIsolation`, `sandbox`, and `webSecurity`. The security relevance of these settings was checked 2026-11-26 against [Electron’s security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- **PWA** checks cover manifest and service-worker presence when package metadata advertises PWA tooling.
- **Generic** checks cover README, oversized files, secret-file presence, and bounded-scan notices. The only look inside a protected name is a four-byte ZIP format check on regular files protected solely by their `.key` suffix. A ZIP signature produces a document notice. A short, unreadable or nonmatching file retains the secret finding. The checker never prints or hashes those four bytes.

Adapters intentionally prefer a small explainable rule set over broad regex guessing. Extend the scanner only with a deterministic fixture proving the rule and its false-positive boundary.

For an Electron project, `console.log` in root `scripts/` is treated as tool output only when an
explicit, understood `build.files` allowlist excludes the file and it is not the app entry. These
occurrences are disclosed together in scan notices. Executable `debugger`, imports, security
patterns, and all other source checks still apply there; packaged scripts and ordinary source
retain console detection. This rule recognizes the older `build.files` layout. The v27 electron-builder guide places those settings under `fileOptions`. Checked 2026-11-26 against [electron-builder’s configuration migration](https://www.electron.build/docs/migration/v27-config-changes/).

A Node shebang, a live `require.main === module` entry, a declared package command, or a script that invokes the file supplies additional evidence of command-line output to Project Checker. CommonJS exposes the directly run module as `require.main`. Checked 2026-11-26 against [Node’s main module reference](https://nodejs.org/api/modules.html#accessing-the-main-module).

## Confidence rules

- **Confirmed** requires direct static proof of a broken declaration or reference.
- **Likely** requires concrete risky code or configuration but still needs runtime confirmation.
- **Recommendation** describes missing safeguards or optimization opportunities and must never be called a bug.

Severity and confidence are independent. A high-severity recommendation can matter greatly without being a confirmed defect.

## Verified checks

Tests, lint, builds, audits, and profiling may create caches or artifacts even when source files stay unchanged. Show the exact command and obtain human approval first. Prefer existing scripts already declared by the project. Record the command, exit status, relevant output, duration when useful, and any generated artifacts. Do not install missing dependencies during diagnosis unless the human separately approves installation.
