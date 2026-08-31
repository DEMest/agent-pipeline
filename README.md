# Agent Pipeline

Sets up the loop your project actually needs: prompt → code → tests → PR → CI → merge → deploy.
One config file describes the project; everything else is generated from it. The generated pipeline
is plain files and plain Node, so CI runs it with no AI involved at all.

## Install

In Claude Code, where it also brings slash commands:

    /plugin marketplace add DEMest/agent-pipeline

With Codex, Cursor, Jules or any other agent following the `AGENTS.md` convention, nothing to
install — point it at [AGENTS.md](AGENTS.md) and let it call the tool directly:

    npx --yes github:DEMest/agent-pipeline generate .

See [Other AI tools](#other-ai-tools) for what differs.

## Setup

The agent does the setup, not you. In your project directory:

    /pipeline:init

It detects the stack, reads the real check commands out of your project instead of guessing them,
asks only what it cannot find out on its own, generates the CI workflow, opens a pull request and
takes it to a green build.

### Starting from nothing

You do not need any code first. Make an empty folder, open your agent in it, and ask it to set the
pipeline up — `/pipeline:init` in Claude Code, or plain words anywhere else. It asks which stack you
want (there is nothing to detect yet), creates a minimal skeleton with one smoke test, installs
dependencies so the lockfile exists, and takes the first pull request to a green build.

The point of doing this before writing a feature is that the pipeline proves itself while the
project is still empty. A red pipeline that you plan to fix "once there is real code" never gets
fixed.

A new project starts at `stage: sketch`, where tests are not yet required and pushing straight to
`main` is allowed — the loop should not slow you down while you are still looking for the shape of
the idea.

## What lands in your project

| File | Purpose |
|---|---|
| `.pipeline/config.yml` | the single source of truth; the agent maintains it |
| `.github/workflows/ci.yml` | generated — do not edit by hand |
| `.github/workflows/deploy.yml` | generated, only when a `deploy` section exists |
| `scripts/pipeline.sh` | the same checks locally that CI runs |
| `deploy/compose.yml` | copied to your server on every deploy |
| `.claude/` | Claude Code only: a hook telling the next session whether the pipeline is configured |

Nothing else. The tests and fixtures in this repository stay here — they are what keeps the
generator honest, and they never travel into your project.

## How it works

The config is the only thing you or the agent edit. The workflow and the local script are generated
from it, and each generated file carries a marker with the sha256 of the config it came from:

    # generated-from-config: sha256:5aa5e623…

CI verifies that marker with a single `sha256sum` call. Change the config without regenerating and
the build turns red with an explanation. No YAML parser is needed inside CI, which is why the same
mechanism will work for every stack, not just this one.

The generated pipeline does not depend on the plugin. Clone the repository without Claude Code
installed and it still builds, tests and deploys — the agent is an accelerator, not a runtime
dependency.

## Stacks

**node-ts** — checks taken from `package.json`, Node set up with npm cache.

**java** — Maven or Gradle, detected from the project and written into `project.build`. The build
tool decides three things that cannot be guessed later: the commands, the CI cache, and where the
build artifact ends up, so it is recorded explicitly. Commands go through the project's own wrapper
(`./mvnw`, `./gradlew`) rather than a system-wide install, and CI restores the executable bit on it —
that flag is routinely lost when the wrapper is committed from Windows. JDK version comes from the
project (`java.version`, `maven.compiler.release`, or the Gradle toolchain block) and falls back
to 21.

Verified against a real Spring Boot 4.1.1 project on Java 21 with Maven: generation, `pipeline.sh
test`, `pipeline.sh build` and the drift check all pass, and the jar lands exactly where the
Dockerfile's `COPY` expects it. The container image build itself has not been exercised yet.

**python** — pip, Poetry or uv, detected from the project and written into `project.build`.
The choice decides which commands run and what CI caches, so it is recorded rather than guessed.
Dependency installation checks whether a file exists before using it, but never swallows a failed
install: a missing `requirements.txt` is normal, a broken install must fail the step.

**go** — no build field, because modules and caching are built into the tool itself. Module
download is explicit and the module cache is on.

Python was verified end to end on a real interpreter — config, generation, `pipeline.sh`, and a
deliberately broken test to confirm the gate turns red — but not with pytest or a real dependency
install, because this machine had neither pytest nor network access for pip. Go is covered by the
generator's tests only: no Go toolchain was available to run a real project through.

## Other AI tools

Claude Code gets slash commands from the plugin. Everything else — the generator, the config, the
generated workflows and `scripts/pipeline.sh` — is plain Node and plain files, so any agent can
drive it, and CI runs it with no agent at all.

For Codex, Cursor, Jules, Aider and anything else following the `AGENTS.md` convention, the same
same procedures live in [AGENTS.md](AGENTS.md) at the repository root. Invoke the tool without
Claude-specific variables:

    npx --yes github:DEMest/agent-pipeline generate .

Differences outside Claude Code: no slash commands (you ask in plain words instead), and no
start-of-session hint that the pipeline is unconfigured — that one comes from a Claude Code hook.
The loop itself is identical.

## Commands

| Command | What it does |
|---|---|
| `/pipeline:init` | set the pipeline up in a new or existing project |
| `/pipeline:ship <task>` | branch, test, check, PR, green CI, merge by the project's autonomy mode |
| `/pipeline:fix-ci` | read the failed run, diagnose the cause, fix it — at most three attempts |
| `/pipeline:upgrade` | rebuild the artifacts with the current version of the tool |
| `/pipeline:evolve` | check whether the project outgrew its stage, and tighten the checks |

Outside Claude Code these are the numbered procedures in [AGENTS.md](AGENTS.md), asked for in
plain words rather than typed as commands.

`/pipeline:fix-ci` does not read the raw log. A parser turns hundreds of lines of timestamps and
ANSI codes into the failing job, the failing step, the error messages and the command that step
runs, taken from your config.

## Growing with the project

A three-file sketch and a service with users need different strictness, so the pipeline has a
stage — `sketch`, `shaping`, `product`, `sustained` — recorded in the config. It does not move on
feeling:

    npx --yes github:DEMest/agent-pipeline state .

That prints the observable metrics (source files, lines, direct dependencies, commits,
contributors, age, whether production is configured) and says whether the project has outgrown its
stage, listing the reasons with numbers. The snapshot in `.pipeline/state.json` is rewritten only
when that verdict changes — metrics move with every commit, and writing on each run would bury the
real transition in noise.

Two things make this survive contact with a real codebase:

**Tightening never breaks what is already written.** New rules apply to changed code — lint over
`git diff`, coverage thresholds set to "not below current", `--new-from-rev` for Go. The
alternative is a first run with hundreds of errors in old code, after which the rule gets switched
off entirely and strictness disappears instead of growing.

**Pain counts more than size.** A production rollback, the same place breaking twice, main left red
for a day — these go into `painSignals` and raise the stage regardless of how small the project is.
"The checks were not enough" is a stronger argument than any line count.

The transition itself goes through its own pull request, never alongside a feature: it changes the
rules for all the code, and that deserves to be seen rather than hidden inside someone's diff.

## Keeping projects up to date

The artifacts live in your repository while the tool moves on, so a project set up six months ago
keeps running an old workflow. The drift check will not notice: it compares artifacts against the
config, and here it is the generator that moved, not the config.

Every generated file records which version produced it:

    # generated-by: agent-pipeline 0.1.0

Rebuilding is one command, and it does nothing when there is nothing to do:

    npx --yes github:DEMest/agent-pipeline upgrade .

Review the result with `git diff` and land it through a pull request like any other change — an
upgrade alters what CI checks and what gets deployed, so it deserves the same green run.

## Autonomy

The `autonomy` field decides who presses merge:

- `full` — the agent merges once CI is green;
- `merge-gate` — the agent stops at a green PR and you decide;
- `prod-gate` — the agent merges, and production still waits for your approval.

## Deploying

Set `deploy` in the config and a deploy workflow is generated: build an image tagged with the commit
SHA, push it, copy the compose file to the server, bring it up, poll the healthcheck, and on failure
roll back to the previous image and open an issue linking the run.

Environments with `auto: false` go through a GitHub Environment, so production waits for a human.

Three things the agent cannot do for you:

1. add the `SSH_KEY` and `REGISTRY_TOKEN` secrets to the repository;
2. assign reviewers to the GitHub Environment used by any `auto: false` environment — without them
   no approval is ever requested and production ships silently;
3. install Docker on the server and create the user named in `host`.

The server's host key is trusted on first connection (`ssh-keyscan`). That protects against
eavesdropping but not against host impersonation during the very first deploy. If that matters,
pin a known host key in a secret instead.

## Current limits

Stated plainly, because a template that oversells itself wastes your time:

- no database backup before migrations, though the design calls for one;
- the ratchet is documented in the evolve skill but not automated: the agent narrows new rules to
  changed files by hand, the generator does not emit that wiring yet;
- no guard hooks — nothing mechanically stops a push straight to `main` or a committed secret.

## Development

    npm install
    npm test

The skill documents under `skills/` are written in Russian: they are read by the agent, not by you.
