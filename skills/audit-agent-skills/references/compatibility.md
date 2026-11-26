# Compatibility evidence

The scanner implements a conservative shared contract plus separate Claude and Codex profiles. It is intentionally an auditor, not a standards authority.

## Shared Agent Skills contract

- A skill is a directory containing `SKILL.md`. An explicit root may be one skill. Collection discovery looks up to three directory levels below the root and records the skill count for each container. The roots report names hidden folders skipped during discovery, including backup and system directories. Discovery skips Git history and Node dependency folders. Empty folders are ignored.
- YAML frontmatter requires `name` and `description`. The four optional fields are `license`, `compatibility`, `metadata` and `allowed-tools`. The specification limits `compatibility` to 500 characters and marks `allowed-tools` as experimental. The checker names extra top-level fields in one portability note. Keys inside the `metadata` map belong to the author. Checked 2026-11-26 against the [Agent Skills specification](https://agentskills.io/specification#frontmatter).
- The checker reads commonly used YAML shapes in both skill frontmatter and optional Codex metadata. YAML requires unique mapping keys and spaces for block indentation. A colon followed by a space inside a plain scalar requires quoting or a block scalar. Syntax outside the supported subset receives a review finding. Checked 2026-11-26 against the [YAML 1.2.2](https://yaml.org/spec/1.2.2/).
- `name` must match the parent directory, use lowercase letters, digits, and hyphens, and avoid leading, trailing, or consecutive hyphens.
- The body should stay concise and progressively disclose detail through `scripts/`, `references/`, and `assets/`.
- Markdown links resolve relative to their document. Skill-folder variables and bundle-root paths refer to the installation. Referenced names must match the case on disk. In the skill instructions and optional interface YAML, a missing internal Markdown link or a missing file named under `scripts/`, `references/` or `assets/` is a structural error. The checker asks for review when a link target, plausible bundle path or path leaving the skill cannot be verified.
- A Markdown reference reached through another reference should also have a link from the skill instructions. A Markdown reference over 100 lines should have a contents heading or bold contents label in its first 30 lines.

## Claude profile

- User skills commonly live in `~/.claude/skills`.
- Names are at most 64 characters. The upload documentation reserves `anthropic` and `claude`. The checker matches each as a whole hyphen-separated word, including at either end of the name. Checked 2026-11-26 against [Anthropic skill structure](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#skill-structure).
- Descriptions are at most 1024 characters and should say both what the skill does and when it should trigger.
- Anthropic's coding CLI documents additional fields including `model`, `context` and `agent`. The checker attributes the extra top-level fields in the CLI reference to that product and uses “product unconfirmed” for other extra fields. Claude uploads accept only the six specification fields. Checked 2026-11-26 against [Anthropic’s CLI frontmatter reference](https://code.claude.com/docs/en/skills#frontmatter-reference).
- **Description.** Claude uploads restrict angle brackets. The local CLI accepts them and displays the escaped forms `&lt;` and `&gt;`. Checked 2026-11-26 against [Anthropic’s packaging validator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/quick_validate.py) and [CLI description display](https://code.claude.com/docs/en/skills#angle-brackets-in-a-skill-description-show-as-lt-and-gt).
- **Name.** Angle brackets violate the upload name rules. The local CLI also refuses a frontmatter name containing either bracket. A valid folder name can still invoke the skill. Checked 2026-11-26 against [Anthropic skill structure](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#skill-structure) and [CLI name handling](https://code.claude.com/docs/en/skills#characters-a-skill-name-cant-hold).

## Codex profile

- Current standard discovery roots include `~/.agents/skills` and repository `.agents/skills`; some local installations also mirror personal skills under `~/.codex/skills`.
- `agents/openai.yaml` can describe the interface, the invocation policy or tool dependencies. A policy can set `allow_implicit_invocation` without declaring a display interface. Dependencies appear under `dependencies.tools`. The documented tool type is `mcp`. Checked 2026-11-26 against [OpenAI, Build skills, optional metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata).
- Product-specific tool names or MCP dependencies can be valid while still reducing portability.

## Static-analysis boundary

### Agent-specific capabilities

The portability check reads the skill instructions, the optional interface YAML and Markdown under `references/`. It reports the first exact capability name in each file whose target product is undeclared. A `compatibility` field naming either documented host covers a shared name. The list uses distinctive identifiers because common words such as “Read” and “Stop” occur throughout ordinary instructions.

- Claude Code tools include `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`, `TodoWrite`, `TaskStop`, `ToolSearch` and `WebFetch`. Hooks include `PreSkillShellCommand`, `PostToolUseFailure` and `PostToolBatch`. The checker uses the distinctive compound identifiers from the tools and lifecycle-event tables. It omits names shared with ordinary prose, programs, languages or protocols. Checked 2026-11-26 against the [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference) and [hooks reference](https://code.claude.com/docs/en/hooks).
- Codex identifiers include `apply_patch`, `exec_command`, `write_stdin`, `update_plan`, `PreModelRequest`, `PostModelRequest` and `request_user_input`. Collaboration tools include `spawn_agent`, `wait_agent`, `followup_task` and the other agent-management calls in the tool definitions. Available tools depend on the session. Checked 2026-11-26 against the [Codex hooks and tool coverage](https://learn.chatgpt.com/docs/hooks#tool-coverage), [OpenAI's Codex collaboration-mode instructions](https://github.com/openai/codex/blob/main/codex-rs/collaboration-mode-templates/templates/default.md) and [Codex collaboration tool definitions](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs).
- Both hosts document `WebSearch`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `PermissionRequest`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `SubagentStart` and `SubagentStop`. Checked 2026-11-26 against the tool and hook references above.

### Description listing budgets

The character totals measure the scanned names and descriptions. Formatting, file paths, model choice and settings can affect the actual listing.

- Claude Code estimates its default listing budget from 1% of the model's context window. A setting can change that fraction or an environment variable can set a character count. Checked 2026-11-26 against [Claude Code skill discovery](https://code.claude.com/docs/en/skills).
- Codex budgets up to 2% of the context window by default and falls back to 8,000 characters when the window is unknown. Its list also includes file paths. Users can configure a token budget. Checked 2026-11-26 against [OpenAI, Build skills](https://learn.chatgpt.com/docs/build-skills).

### Files and limits

The scanner reads bounded text and metadata. It does not execute scripts, import skill code, call network services, evaluate prompts, or prove that an agent will choose or follow a skill correctly. The report groups linked installs with their in-root target. The file walk skips nested symlinks. An external install link receives a structure finding naming its unchecked target. Unresolved links carry an operating-system error code such as `ENOENT`. Build output and vendor folders use the ordinary scan budget. Dependency and Python cache folders receive findings with unread file counts. Git history is excluded. The scanner checks instruction and interface metadata first, then reports any files left unread by limits. Heuristic findings require human judgment.

## Command checks

The safety axis checks shell scripts (sh, bash and zsh), Node scripts (js, cjs, mjs and ts), Python scripts (py) and PowerShell scripts (ps1) anywhere in a skill. Markdown instruction files are checked inside labelled shell fences, including PowerShell fences. Markdown prose and data files such as CSV, TSV and JSON supply no command evidence.

| Language | Destructive operations | Execution | Network access |
|---|---|---|---|
| Shell | `rm` with recursive and force options together, including separate flags, quoted commands or flags, and a leading `sudo`. Also `find -delete`, `git reset --hard`, `git push --force` and `dd if=`. | A download from `curl` or `wget` piped to a shell. | `curl` and `wget` with or without options. Package installation with `npm install`, `npm i`, `npm ci`, `npx` with a package, `pip install`, `pip3 install` or `python -m pip install`. |
| Node | Calls to `fs.rm` and `fs.rmSync` with the recursive option set to true. | Calls to `eval` or the child_process functions `exec`, `execSync`, `execFile`, `execFileSync`, `spawn`, `spawnSync` and `fork`. Includes namespace, destructured require and named import forms. | Calls to `fetch`, or the `get` and `request` methods of `http` and `https`. |
| Python | Calls to `shutil.rmtree`. | Calls to `os.system`, `eval`, or the subprocess methods `run`, `Popen`, `call`, `check_call`, `check_output`, `getoutput` and `getstatusoutput`. | Calls to the requests methods `get`, `post`, `put`, `patch`, `delete`, `head`, `options` and `request`, or the urllib.request methods `urlopen` and `urlretrieve`. |
| PowerShell | `Remove-Item` with the `-Recurse` switch. | A download piped to a shell. | `Invoke-WebRequest` or the external download and package commands listed for shell. |

One finding per rule per file points to a matching command. Matching recognizes common literal spellings. Other languages, dynamically constructed commands, runtime values and other spellings can perform the same operations.

## Personal paths

The portability check reads Markdown instructions, optional interface YAML and the script types above. It recognizes user-specific home directories on macOS, Linux and Windows, the Linux root user's home, and the Windows environment reference formed by enclosing `USERPROFILE` in percent signs. Web addresses, the shared macOS users directory, placeholder names, and data tables are excluded. Home-relative forms such as `~/` and `$HOME/` resolve for the current account and are portable across users. A relative Desktop workspace folder also carries no account name.
