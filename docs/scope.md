# Scope

## What it does

- **Skills Checker** inspects the requested skill folders for metadata, trigger wording, bundled file and reference problems, portability, and visible command risks. It groups identical mirrors and ranks similar descriptions for human review. On default runs it also counts skill files at other listed locations and identifies partial counts.
- **Project Checker** inspects one project tree. It checks project metadata, resolves local JavaScript and TypeScript references, and looks for signs of missing tests, risky code and configuration. Each finding carries its evidence, confidence and a suggested verification step. The report records scan limits and the languages found.
- Both commands print a terminal report or JSON. The [report format](../REPORT-FORMAT.md) describes exactly what each report contains.

## What it will never do

- Neither checker executes the files it inspects, starts project scripts or hooks, installs dependencies, contacts a service or changes scanned files.
- Neither checker fixes its findings or approves a repair. A person can use a report to commission separate work.
- A static verdict covers the material its rules could examine. Runtime behavior, security certification and completeness of unread material are outside its scope.

## How good it must be

- Give a location someone can inspect. Explain uncertain evidence and name skipped material.
- Keep both commands runnable with Node.js alone. Test rules on a triggering input and on a similar clean input.
