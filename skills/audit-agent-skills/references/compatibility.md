# Compatibility evidence

The scanner implements a conservative shared contract plus separate Claude and Codex profiles. It is intentionally an auditor, not a standards authority.

## Shared Agent Skills contract

- A skill is a directory containing `SKILL.md`. An explicit root may be one skill. Collection discovery looks up to three directory levels below the root and records the skill count for each container. Hidden containers are included. A backup tree within the search depth can therefore contribute copies. Discovery skips Git history and Node dependency folders. Empty folders are ignored.
- YAML frontmatter requires `name` and `description`.
- `name` must match the parent directory, use lowercase letters, digits, and hyphens, and avoid leading, trailing, or consecutive hyphens.
- The body should stay concise and progressively disclose detail through `scripts/`, `references/`, and `assets/`.
- Markdown links resolve relative to their document. Skill-folder variables and bundle-root paths refer to the installation. Referenced names must match the case on disk. An uncertain target receives a review finding.

## Claude profile

- User skills commonly live in `~/.claude/skills`.
- Names are at most 64 characters and must not contain the reserved words `anthropic` or `claude`.
- Descriptions are at most 1024 characters and should say both what the skill does and when it should trigger.
- `allowed-tools` is recognized as model-specific and therefore receives a portability review note.

## Codex profile

- Current standard discovery roots include `~/.agents/skills` and repository `.agents/skills`; some local installations also mirror personal skills under `~/.codex/skills`.
- `agents/openai.yaml` is optional interface and policy metadata, not a shared requirement.
- Product-specific tool names or MCP dependencies can be valid while still reducing portability.

## Static-analysis boundary

The scanner reads bounded text and metadata. It does not execute scripts, import skill code, call network services, evaluate prompts, or prove that an agent will choose or follow a skill correctly. The report groups linked installs with their in-root target. The file walk skips nested symlinks. An external install link receives a structure finding naming its unchecked target. Unresolved links carry an operating-system error code such as `ENOENT`. Build output and vendor folders use the ordinary scan budget. Dependency and Python cache folders receive findings with unread file counts. Git history is excluded. The scanner checks instruction and interface metadata first, then reports any files left unread by limits. Heuristic findings require human judgment.
