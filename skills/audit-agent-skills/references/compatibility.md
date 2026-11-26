# Skills Checker compatibility evidence

## Shared Agent Skills contract

- A skill directory contains `SKILL.md`. Optional scripts, references and assets keep detail outside the main instructions. Checked 2026-11-26 against the [Agent Skills specification](https://agentskills.io/specification#directory-structure).
- Frontmatter requires `name` and `description`. The four optional fields are `license`, `compatibility`, `metadata` and the experimental `allowed-tools`. The compatibility text has a 500-character limit. The author chooses the keys inside the metadata map. Skills Checker names extra top-level fields in one portability note. Checked 2026-11-26 against the [frontmatter specification](https://agentskills.io/specification#frontmatter).
- The name must match its folder and contain 1–64 lowercase letters, digits or hyphens. Hyphens must have a letter or digit on each side. The description must contain 1–1,024 characters and explain the skill's purpose and when to use it. Checked 2026-11-26 against the [shared field constraints](https://agentskills.io/specification#name-field).
- YAML uses unique keys and spaces for block indentation. A colon followed by a space inside a scalar needs quoting or block-scalar syntax. The checker reports YAML outside its supported subset for review. Checked 2026-11-26 against [YAML 1.2.2](https://yaml.org/spec/1.2.2/).
- The specification advises linking from the skill root. Anthropic recommends linking directly from the main guide to each reference and including a contents section at the top of references longer than 100 lines. Skills Checker tests Markdown references for a contents heading or bold label in their first 30 lines. Checked 2026-11-26 against the [file reference specification](https://agentskills.io/specification#file-references) and [Anthropic’s authoring guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#avoid-deeply-nested-references).

Skills Checker accepts a single skill as an explicit root. For a collection it searches up to three levels below the root, counts skills per container and lists hidden directories skipped during discovery. It skips Git history, Node dependencies and empty folders during discovery.

The checker resolves a relative Markdown link from its document and supported skill-folder variables from the installation. It checks filename case. In the skill instructions and optional interface YAML, a missing internal Markdown link or a missing file named under `scripts/`, `references/` or `assets/` is a structural error. A plausible bundle path or a link leaving the skill can instead require verification.

## Claude profile

- Claude Code's personal skills live in `~/.claude/skills`. At the personal, project and enterprise locations it follows symlinked skill folders and loads a shared target once. Plugin links have separate rules. Checked 2026-11-26 against [Claude Code skill locations](https://code.claude.com/docs/en/skills#choose-where-skills-load).
- In terminal sessions signed in with a claude.ai account, Claude Code v2.1.273 and later downloads enabled account skills into `~/.claude/skills/synced/` and checks for changes while the session runs. Checked 2026-11-26 against [where synced skills load](https://code.claude.com/docs/en/skills#where-synced-skills-load).
- Claude's upload rules reserve `anthropic` and `claude` in names. The checker matches them as whole hyphen-separated words, including at either end of a name. Checked 2026-11-26 against [Anthropic's skill structure requirements](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#skill-structure).
- Claude Code recognizes extra fields including `model`, `context` and `agent`. The checker labels fields from that reference as Claude Code extensions and uses “product unconfirmed” for other extra fields. Checked 2026-11-26 against the [CLI frontmatter reference](https://code.claude.com/docs/en/skills#frontmatter-reference).
- Uploads to claude.ai and the Skills API accept only the six top-level specification fields listed above. An extra CLI field causes validation to fail. Checked 2026-11-26 against [Anthropic’s upload and packaging rules](https://code.claude.com/docs/en/skills#using-skill-frontmatter-outside-claude-code) and its [packaging validator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/quick_validate.py).
- **Description.** Claude's packaging validator rejects angle brackets. The local CLI accepts them in the description and escapes them for display. Checked 2026-11-26 against the [validator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/quick_validate.py) and [Claude Code description display](https://code.claude.com/docs/en/skills#angle-brackets-in-a-skill-description-show-as-lt-and-gt).
- **Name.** Angle brackets violate the upload naming rules. Claude Code refuses a frontmatter name containing either bracket. A valid directory name can still invoke the skill. Checked 2026-11-26 against [upload name requirements](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#skill-structure) and [CLI name handling](https://code.claude.com/docs/en/skills#characters-a-skill-name-cant-hold).

## Codex profile

- Codex discovers personal skills in `~/.agents/skills` and repository skills in each `.agents/skills` between the working directory and the repository root. It follows linked skill folders to their targets. Checked 2026-11-26 against [OpenAI’s local discovery rules](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
- Codex also retains the older user-level skills folder in its configuration directory for backward compatibility. Its default path is `~/.codex/skills`. The loader marks this location deprecated. Checked 2026-11-26 against the [Codex skill-root implementation](https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs) and [OpenAI’s default installer path](https://github.com/openai/skills/blob/main/skills/.system/skill-installer/scripts/install-skill-from-github.py).
- Optional `agents/openai.yaml` metadata can specify the interface, invocation policy and tool dependencies. A policy can set `allow_implicit_invocation` independently of the display interface. The documented dependency example places an `mcp` entry under `dependencies.tools`. Skills Checker reports agent-specific tool names and dependencies as portability evidence. Checked 2026-11-26 against [OpenAI’s optional metadata reference](https://learn.chatgpt.com/docs/build-skills#optional-metadata).

## Static-analysis boundary

### Agent-specific capabilities

The portability check reads the skill instructions, the optional interface YAML and Markdown under `references/`. It reports the first exact capability name in each file whose target product is undeclared. A `compatibility` field naming either documented host covers a shared name. The list uses distinctive identifiers because common words such as “Read” and “Stop” occur throughout ordinary instructions.

- Claude Code tools include `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`, `TodoWrite`, `TaskStop`, `ToolSearch` and `WebFetch`. Hooks include `PreSkillShellCommand`, `PostToolUseFailure` and `PostToolBatch`. The checker uses the distinctive compound identifiers from the tools and lifecycle-event tables. It omits names shared with ordinary prose, programs, languages or protocols. Checked 2026-11-26 against the [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference) and [hooks reference](https://code.claude.com/docs/en/hooks).
- Codex identifiers include `apply_patch`, `exec_command`, `write_stdin`, `update_plan`, `PreModelRequest`, `PostModelRequest` and `request_user_input`. Collaboration tools include `spawn_agent`, `wait_agent`, `followup_task` and the other agent-management calls in the tool definitions. Available tools depend on the session. Checked 2026-11-26 against the [Codex hooks and tool coverage](https://learn.chatgpt.com/docs/hooks#tool-coverage), [OpenAI's Codex collaboration-mode instructions](https://github.com/openai/codex/blob/main/codex-rs/collaboration-mode-templates/templates/default.md) and [Codex collaboration tool definitions](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs).
- Both hosts document `WebSearch`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `PermissionRequest`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `SubagentStart` and `SubagentStop`. Checked 2026-11-26 against [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Claude Code tools](https://code.claude.com/docs/en/tools-reference) and [Codex hooks and tool coverage](https://learn.chatgpt.com/docs/hooks#tool-coverage).

### Description listing budgets

The character totals measure the scanned names and descriptions. Formatting, file paths, model choice and settings can affect the actual listing.

- Claude Code estimates its default listing budget from 1% of the model's context window. A setting can change that fraction or an environment variable can set a character count. Checked 2026-11-26 against [Claude Code skill discovery](https://code.claude.com/docs/en/skills#skill-descriptions-are-cut-short).
- Codex budgets up to 2% of the context window by default and falls back to 8,000 characters when the window is unknown. Its list also includes file paths. Users can configure a token budget. Checked 2026-11-26 against [OpenAI, Build skills](https://learn.chatgpt.com/docs/build-skills).

### Files and limits

The scanner reads bounded text and metadata. It does not execute scripts, import skill code, call network services, evaluate prompts, or prove that an agent will choose or follow a skill correctly. The report groups linked installs with their in-root target. The file walk skips nested symlinks. An external install link receives a structure finding naming its unchecked target. Unresolved links carry an operating-system error code such as `ENOENT`. Build output and vendor folders use the ordinary scan budget. Dependency and Python cache folders receive findings with unread file counts. Git history is excluded. The scanner checks instruction and interface metadata first, then reports any files left unread by limits. Heuristic findings require human judgment.

## Command checks

The three command checks in the table below read shell scripts (sh, bash and zsh), Node scripts (js, cjs, mjs and ts), Python scripts (py) and PowerShell scripts (ps1) anywhere in a skill. Markdown instruction files are checked inside labelled shell fences, including PowerShell fences. The five additional checks read the full text of every file within the same collection limits, including prose, inline examples, all fences and data files. Each code appears at most once per file.

- `download-and-run` finds a download piped into an interpreter or used in a shell substitution that runs it.
- `hidden-characters` counts tag characters outside flag sequences, direction controls and runs of zero-width characters or variation selectors. It reports their kinds and first line.
- `credential-access` matches specific private login files, credential commands and environment output piped to a transfer tool.
- `decode-and-run` finds a decode followed by execution on the same line in a shell, Python or JavaScript example.
- `safeguard-off` matches specific switches and settings that disable approvals, certificate verification or download protection.

The following checks cover skill loading, permissions, Markdown, persistent changes and installed names.

- `load-time-command` points to a command in the skill instructions that Claude Code runs when the skill loads.
- `frontmatter-hooks` names the declared hooks so you can inspect which events run commands automatically.
- `unrestricted-shell-grant` identifies a tool grant that pre-approves every Bash command.
- `hidden-from-menu` notes that the agent can start a skill hidden from the skills menu.
- `hidden-comment` counts long HTML comments hidden in a Markdown preview and shows the start of the first one.
- `standing-file-write` notes an instruction to write to a file that can affect later sessions.
- `look-alike-name` names another installed skill with a one-edit difference or matching look-alike characters.

Of these seven checks, `load-time-command`, `frontmatter-hooks` and `unrestricted-shell-grant` produce exit 2. A hidden comment or a similar name requests review. The menu and standing-file checks print NOTE and count toward `counts.info`.

| Language | Destructive operations | Execution | Network access |
|---|---|---|---|
| Shell | `rm` with recursive and force options together, including separate flags, quoted commands or flags, and a leading `sudo`. Also `find -delete`, `git reset --hard`, `git push --force` and `dd if=`. | A download from `curl` or `wget` piped to a shell. | `curl` and `wget` with or without options. Package installation with `npm install`, `npm i`, `npm ci`, `npx` with a package, `pip install`, `pip3 install` or `python -m pip install`. |
| Node | Calls to `fs.rm` and `fs.rmSync` with the recursive option set to true. | Calls to `eval` or the child_process functions `exec`, `execSync`, `execFile`, `execFileSync`, `spawn`, `spawnSync` and `fork`. Includes namespace, destructured require and named import forms. | Calls to `fetch`, or the `get` and `request` methods of `http` and `https`. |
| Python | Calls to `shutil.rmtree`. | Calls to `os.system`, `eval`, or the subprocess methods `run`, `Popen`, `call`, `check_call`, `check_output`, `getoutput` and `getstatusoutput`. | Calls to the requests methods `get`, `post`, `put`, `patch`, `delete`, `head`, `options` and `request`, or the urllib.request methods `urlopen` and `urlretrieve`. |
| PowerShell | `Remove-Item` with the `-Recurse` switch. | A download piped to a shell. | `Invoke-WebRequest` or the external download and package commands listed for shell. |

One finding per rule per file points to a matching command. Matching recognizes common literal spellings. Other languages, dynamically constructed commands, runtime values and other spellings can perform the same operations.

## Personal paths

The portability check reads Markdown instructions, optional interface YAML and the script types above. It recognizes user-specific home directories on macOS, Linux and Windows, the Linux root user's home, and the Windows environment reference formed by enclosing `USERPROFILE` in percent signs. Web addresses, the shared macOS users directory, placeholder names, and data tables are excluded. The checker accepts home-relative forms such as `~/` and `$HOME/`. A relative Desktop workspace folder also carries no account name.
