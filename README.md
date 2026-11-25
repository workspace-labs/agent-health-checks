# Health checks for AI agents

**An agent is only as good as the instructions it loads and the code it opens. Almost nobody checks either.**

![Two read-only doctors: the skills checker and the project checker, each shown with its real terminal output](media/health-checks.png)

This is a working pattern for auditing both — with two read-only checkers that produce evidence a person can act on, and no authority to change anything they find.

It is tool-agnostic. Nothing here depends on a particular model, CLI, or framework.

Both checkers are in this repo — [`skills/`](skills). Two dependency-free Node scripts you can run in a minute.

---

## The problem, twice

### The toolbox rots, and it doesn't look like rot

Agents choose a tool by reading its description. So the moment two tools describe overlapping jobs, the choice between them stops being predictable — and that failure doesn't present as a duplicate. It presents as a *random bug*: the same request works on Monday and does something strange on Thursday, and you go looking in the wrong place.

It happens easily. Skills arrive from different sources, get installed months apart, and nobody re-reads the descriptions as a set. An audit of one working toolbox today: **34 skills, and two of them still share a single name.**

The same blind spot hides slower problems. A tool can ship bundled code that runs shell commands, reach the network, point at a reference file that isn't there, or link out of its own folder through a symlink. None of that is visible from the one line an agent reads before loading it.

### The person approving can't see the state of the code

Before you let an agent change a project, the useful question is *what's already fragile here* — broken local references, untested paths, patterns that swallow errors, files nobody imports any more.

Asking the agent that is about to do the work is not an answer. That's an opinion produced by the thing being judged. And if the person holding the decision doesn't read code — very often they don't, and shouldn't have to — they have no way to form their own.

---

## The pattern: two doctors, both read-only

| Checker | Reads | Reports |
|---|---|---|
| **Skills doctor** | The instructions agents load | Structure, trigger wording, safety signals, portability, cross-model compatibility |
| **Projects doctor** | JavaScript and TypeScript projects | Structure, broken local references, risky patterns, testing gaps, performance signals, maintainability |

For projects written in another language, a **Healthy** result means the source code in that language was **not examined**.

**Two, not one.** Instructions and source code are different material with different risks, and one report that mixes them serves neither. Separate checkers get precise triggers, tighter boundaries, and a report you can read in one sitting.

---

## Run them

Both checkers live in [`skills/`](skills). They are plain Node scripts — no dependencies, no install step, no network access. Set the shell variable `PROJECT_DIR` to the absolute path of the project you want to check. Use a trusted clone outside that project.

```bash
git clone https://github.com/workspace-labs/agent-health-checks.git
cd agent-health-checks

# check the instructions your agents load
node skills/audit-agent-skills/scripts/audit-skills.js

# check the code before an agent changes it
node skills/audit-project-health/scripts/audit-project.js --path "${PROJECT_DIR:?Set PROJECT_DIR to the absolute project path}"
```

Add `--json` for a machine-readable report. Run either script with `--version` alone to print its release. The [report format](REPORT-FORMAT.md) lists the fields and exit codes for each checker.

Run the tests from the clone. Verified on Node 20.20.2, 22.23.1, 24.22.1, and 26.13.1.

```bash
node --test
```

How often they were tested, the results, and what was never tested: [TESTING.md](TESTING.md).

To install both skills for Claude Code, run these commands from the clone.

```bash
mkdir -p "$HOME/.claude/skills/audit-agent-skills" "$HOME/.claude/skills/audit-project-health"
cp -R skills/audit-agent-skills/. "$HOME/.claude/skills/audit-agent-skills/"
cp -R skills/audit-project-health/. "$HOME/.claude/skills/audit-project-health/"
```

To update an installed copy, get the newer release and repeat the copy steps from its root.

For Codex, put each skill folder in `~/.agents/skills` for personal use. Inside a repository, Codex checks `.agents/skills` at each directory from the working directory up to the repository root. [OpenAI’s local skill locations](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)

Neither script executes what it inspects, reaches the network, or writes to anything it reads.

---

## What makes a checker worth trusting

**It never runs what it inspects.** Static evidence only — no executing bundled scripts, no network, no installs. You are inspecting something you don't yet trust; running it first is the wrong order.

**Project findings** give a file and line, the check that raised the finding, its impact, how to verify it, and a recommended next step. A finding that counts several occurrences may point to just one location. Each finding has a confidence level of *confirmed*, *likely*, or *recommendation*.

**Skill findings** give the check area, severity, location, and a message. The JSON also includes the rule code and a suggestion. The terminal shows up to eight findings per skill.

**It fails closed and stays honest about its edges.** A link escaping its own folder is refused and reported, not followed. Scans are bounded — and whatever got skipped for size stays visible in the report rather than quietly counting as clean.

**It says what it cannot prove.** A clean static report is not proof of runtime safety. Saying so is what keeps the clean reports meaningful.

---

## Diagnosis is not treatment

This repository contains the two read-only checkers. Their work ends with a report.

In the author's own workflow outside this repository, a fresh scan supplies the evidence for a repair task. A person approves the task before the repair starts. The author then backs up the affected files, checks the change, and scans again to compare the results.

---

## Why this got built

Neither checker was designed in the abstract. Both are scar tissue.

**The skills doctor** came from losing whole working sessions to a problem that never announced itself. Two tools quietly competed for the same job; the symptom was inconsistency, not duplication, so the search always started somewhere else. It happened more than once — including with a well-known skill, hundreds of thousands of installs deep, that turned out to do the same job as a tool already installed. The rule that came out of it (*search before you build a new tool*) was the obvious half. The audit is the half with teeth, because a rule is a request and a check is a result.

**The projects doctor** came from one sentence: *"I'm not a developer — even if I read the code I won't understand it."* That's the honest position of most people approving AI work now, and it makes "do you approve this?" an unanswerable question. So the code got a checker that answers in plain language, with a location attached, before anything is changed.

The general lesson underneath both: **when the same shape of mistake keeps coming back, don't write a smarter rule — build the check.** Rules depend on someone remembering them at the exact moment they're inconvenient. Checks don't.

---

## What it costs

An honest accounting:

- **Audits produce noise.** That same toolbox reports nine items as *needs review* — and most of them are deliberate and fine. Somebody still has to read them, and a report nobody reads is worse than no report, because it looks like coverage.
- **Static analysis has a ceiling.** It sees structure and shape, not behaviour. It will never catch everything, and pretending otherwise is how a clean report becomes a false comfort.
- **It's another thing to maintain.** The checkers are software too, with their own bugs and their own blind spots.

**Worth it when:** more than one agent shares a toolbox, tools arrive from outside, or the person approving the work can't personally verify it.

**Not worth it when:** one agent, a couple of hand-written tools, nothing anyone else depends on. Read them yourself and move on.

---

## The shortest version

> Check the instructions before an agent loads them, and the code before an agent changes it. Keep the check read-only, evidence-backed, and honest about its own certainty — then make every fix pass through a person.

---

by Workspace Labs · Drawn from a working system, not a thought experiment — see a showcase of it running, and the pattern it sits beside: separation of duties for AI agents.
