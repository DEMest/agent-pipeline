# Agent Pipeline

A Claude Code plugin that sets up the loop your project actually needs: prompt → code → tests → PR →
CI → merge → deploy. One config file describes the project; everything else is generated from it.

## Install

    /plugin marketplace add DEMest/agent-pipeline

## Setup

The agent does the setup, not you. In your project directory:

    /pipeline:init

### Starting from nothing

You do not need any code first. Make an empty folder, open Claude Code in it, run `/pipeline:init`,
and answer the questions — the agent asks which stack you want (there is nothing to detect yet),
creates a minimal skeleton with one smoke test, installs dependencies so the lockfile exists, and
takes the first pull request to a green build.

The point of doing this before writing a feature is that the pipeline proves itself while the
project is still empty. A red pipeline that you plan to fix "once there is real code" never gets
fixed.

A new project starts at `stage: sketch`, where tests are not yet required and pushing straight to
`main` is allowed — the loop should not slow you down while you are still looking for the shape of
the idea.

It detects the stack, reads the real check commands out of your project instead of guessing them,
asks only what it cannot find out on its own, generates the CI workflow, opens a pull request and
takes it to a green build.

## What lands in your project

| File | Purpose |
|---|---|
| `.pipeline/config.yml` | the single source of truth; the agent maintains it |
| `.github/workflows/ci.yml` | generated — do not edit by hand |
| `.github/workflows/deploy.yml` | generated, only when a `deploy` section exists |
| `scripts/pipeline.sh` | the same checks locally that CI runs |
| `deploy/compose.yml` | copied to your server on every deploy |
| `.claude/` | a hook that tells the next agent whether the pipeline is configured |

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

## Commands

| Command | What it does |
|---|---|
| `/pipeline:init` | set the pipeline up in a new or existing project |
| `/pipeline:ship <task>` | branch, test, check, PR, green CI, merge by the project's autonomy mode |
| `/pipeline:fix-ci` | read the failed run, diagnose the cause, fix it — at most three attempts |

`/pipeline:fix-ci` does not read the raw log. A parser turns hundreds of lines of timestamps and
ANSI codes into the failing job, the failing step, the error messages and the command that step
runs, taken from your config.

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

- **python** and **go** are valid in the config but generation refuses with an explicit error
  rather than producing something broken;
- no maturity stages yet — checks do not tighten on their own as a project grows;
- no database backup before migrations, though the design calls for one.

## Development

    npm install
    npm test

The skill documents under `skills/` are written in Russian: they are read by the agent, not by you.
