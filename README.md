# AgentCYA

A second-LLM permission reviewer for AI coding harnesses (Claude Code, OpenCode).

## Why

You're usually choosing between two bad options: `--dangerously-skip-permissions` lets the agent rip but auto-approves anything it dreams up, while the default permission flow buries you in a prompt for every other command. AgentCYA is the middle path — a separate LLM reviews each tool call (and reads the contents of scripts it's about to execute) and decides `allow` / `deny` / `ask` on the merits, so the agent keeps moving on routine work and only pulls you in when the risk actually warrants it.

## How It Works

AgentCYA sits between the coding harness and execution. The decision pipeline is:

```
stdin JSON → Hard deny? → File enrichment (Bash) → LLM review → stdout JSON + audit log
```

1. **Hard deny** — Hardcoded regex patterns catch obviously destructive commands (`rm -rf /`, `curl | bash`, `sudo`, etc.). Blocked immediately, no LLM call.
2. **File enrichment** — When a Bash command runs a script (`bash foo.sh`, `node x.js`, `./run`, `python3 script.py`), AgentCYA reads the script from disk and includes its contents in the LLM prompt. The reviewer sees what's actually about to execute, not just the invocation — which closes the create-then-execute loophole where a write step slips past unreviewed.
3. **LLM review** — Everything else is sent to the `claude` or `opencode` CLI binary (spawned locally, no HTTP) for a security assessment.
4. **Audit log** — Every decision is appended to `~/.agent-cya/audit.log`.

## Quick Start

```bash
npm install

# Manual review:
echo '{"toolType":"Bash","command":"ls"}' | node src/main.ts review
```

Node 23.9+ is required for native `.ts` execution during development; the published npm package ships compiled JS in `dist/` and runs on the same Node baseline.

## Usage

### As a Claude Code Hook

Install globally so the `agent-cya` binary is on PATH:

```bash
npm install -g agent-cya
```

Then add a `PermissionRequest` hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "agent-cya hook claude-code",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

The `hook claude-code` subcommand reads Claude Code's `PermissionRequest` input on stdin, runs the review pipeline, and emits a `hookSpecificOutput` decision. It reviews via the `claude` CLI by default; pass `--reviewer opencode` (before the subcommand) to use OpenCode instead. To gate file edits too, widen the matcher to `"Bash|Write|Edit"`.

The hook only fires when Claude Code would otherwise prompt for permission — already-allowlisted commands skip it. AgentCYA's `allow` / `deny` / `ask` decisions map directly to `PermissionRequest` behaviors; `ask` falls through to Claude Code's standard permission dialog.

> ⚠️ **Watch out for "autopilot accept" on fallback prompts.** When the reviewer LLM is unreachable or returns `ask`, Claude Code surfaces its **standard approval prompt** — visually identical to any routine permission ask, with no AgentCYA reasoning attached. With a fast reviewer the prompt can flash for just a few seconds before the hook lands a final decision, making it easy to dismiss reflexively. Two specific failure modes:
>
> 1. **Clicking "Yes"** runs the command once. Annoying but recoverable — the audit log captures what got through.
> 2. **Clicking "Yes, and don't ask again for X"** adds the command pattern to your allowlist, which **bypasses the hook entirely** for future matches. Worse than #1 and silent.
>
> To give yourself a real interaction window, AgentCYA can **pad `ask` decisions to a minimum wall-clock duration** so the prompt stays open long enough to actually read. Opt in by setting `AGENT_CYA_MIN_ASK_MS` to the desired hold time in milliseconds (e.g. `60000` for 60s, `30000` for 30s). Allows and denies still return as fast as the LLM does; only the genuinely ambiguous calls hold the prompt open. Padding is off by default. If you enable it, make sure the hook `timeout` (seconds) is greater than `AGENT_CYA_MIN_ASK_MS / 1000` plus your LLM's worst-case review time. (The env var is process-wide — it applies to any harness that goes through AgentCYA's review pipeline — but the autopilot-accept failure mode this defends against is Claude-Code-specific, which is why it's documented here.)
>
> If you see an unexpected approval prompt while AgentCYA is installed, treat it as a signal that the reviewer isn't reaching the LLM — check `~/.agent-cya/audit.log` to see whether AgentCYA was invoked and what it decided before accepting.

### As an OpenCode Plugin

AgentCYA ships its OpenCode plugin as a subpath export, so the integration is two steps. First install the package:

```bash
npm install agent-cya
```

Then reference the plugin's subpath in your `opencode.json`:

```json
{ "plugin": ["agent-cya/opencode"] }
```

The plugin runs the same in-process review pipeline that the CLI hook uses. Its `permission.ask` handler emits the AgentCYA decision directly as OpenCode's `output.status` — no spawning, no JSON parsing, no fallback prompts.

> ⚠️ **Heads up — OpenCode may not actually invoke the plugin today.** OpenCode currently gates `permission.ask` so it doesn't fire for first-encounter commands or in non-interactive `opencode run` sessions, which means the AgentCYA decision never lands. The plugin loads fine and the handler works when invoked directly; this is an upstream issue tracked at [anomalyco/opencode#19927](https://github.com/anomalyco/opencode/issues/19927). Once OpenCode forwards every permission ask to plugins, the integration here works as documented.

By default the plugin reviews via the `claude` CLI. To use OpenCode itself as the reviewer LLM, write a one-liner plugin file that calls the factory:

```typescript
// ~/.config/opencode/plugins/agent-cya.ts
import { createAgentCyaPlugin } from "agent-cya/opencode";
export default createAgentCyaPlugin({ reviewer: "opencode" });
```

…and reference that file from `opencode.json` instead of the subpath:

```json
{ "plugin": ["./plugins/agent-cya.ts"] }
```

## CLI

```
agent-cya [--reviewer <reviewer>] review              # review a tool call in AgentCYA's input format
agent-cya [--reviewer <reviewer>] hook claude-code    # run as a Claude Code PermissionRequest hook
```

| Subcommand         | Purpose                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `review`           | Reads AgentCYA's native input on stdin, emits `{decision, reason}` JSON. Useful for shell-level debugging and ad-hoc integrations. |
| `hook claude-code` | Reads Claude Code's `PermissionRequest` input, emits `hookSpecificOutput` JSON, exits 2 on deny. Wire this up directly.            |

`--reviewer` is `claude` (default) or `opencode` — which CLI binary spawns for LLM review. It's a global option on `agent-cya`, so pass it before the subcommand.

## Input/Output Format

### Input (stdin)

```json
{
  "toolType": "Bash",
  "command": "rm -rf /tmp/build",
  "fileContent": null,
  "workingDirectory": "/Users/dev/project"
}
```

- `toolType` — name of the tool (e.g., `Bash`, `Write`, `Edit`)
- `command` — the command or file path being acted on
- `fileContent` — optional file content or edit diff
- `workingDirectory` — optional working directory context

### Output (stdout)

```json
{
  "decision": "deny",
  "reason": "Command matches denied pattern: rm\\s+-rf\\s+\\*"
}
```

### Exit Codes

- `0` — allow or ask (proceed)
- `1` — deny or error

## Architecture

```
src/
├── main.ts                  # Entry point: imports program from cli.ts, calls program.parse()
├── cli.ts                   # Commander.js CLI, dispatches to review / hook claude-code
├── pipeline.ts              # evaluate(): hard-deny → enrich → LLM review, shared by all harnesses
├── harnesses/claude-code.ts # Claude Code PermissionRequest adapter (input/output transforms)
├── opencode-plugin.ts       # OpenCode plugin subpath export: createAgentCyaPlugin() factory
├── rules.ts                 # Hardcoded deny regex patterns, evaluateHardDeny()
├── file-enrich.ts           # For Bash commands that run a script, reads file contents from disk
├── prompt.ts                # buildSystemPrompt() + buildUserPrompt() with XML sections
├── llm.ts                   # Spawns claude/opencode CLI binary, 90s timeout, retry, JSON extractor
└── audit-log.ts             # JSON-lines writer at ~/.agent-cya/audit.log with size-cap rotation
```

Key design decisions:

- **No config file** — deny patterns are hardcoded, not user-configurable
- **No HTTP, no API keys** — LLM review shells out to the `claude` or `opencode` CLI binary via `child_process.spawn`
- **TypeScript end-to-end** — `node` runs `.ts` directly in development; the npm package ships compiled JS in `dist/` via a `prepack` `tsc` step

## Tech Stack

- TypeScript — `node` runs source in dev; `tsc` compiles to `dist/` for the published tarball
- Commander.js — CLI framework
- Vitest — Testing

## Releasing

Releases are driven by [release-please](https://github.com/googleapis/release-please) on `push: main`. Conventional commits (`feat:`, `fix:`, etc.) become a continuously-updated "release PR" with the bumped version + generated `CHANGELOG.md`. Merging that PR cuts a GitHub Release; the `publish.yml` workflow then publishes the tagged version to npm with provenance.

**One-time setup** (this list intentionally exists in the README so it can't drift silently — every item is part of the security posture, not optional polish):

1. **npm trusted publishing** — on npmjs.com, open the package's settings → "Publishing access" → add a trusted publisher with org `<your-org>`, repo `agent-cya`, workflow `.github/workflows/publish.yml`, environment `npm-publish`. No `NPM_TOKEN` ever needs to exist; the workflow mints a short-lived OIDC token per publish.
2. **`npm-publish` environment with required reviewers** — repo Settings → Environments → New environment "npm-publish" → check "Required reviewers" and add yourself (or a small group). Every publish becomes one human click. This is the last-resort gate if any earlier defense fails.
3. **Restrict fork PR workflow runs** — repo Settings → Actions → General → "Fork pull request workflows from outside collaborators" → set to "Require approval for all outside collaborators" (or stricter). Prevents drive-by `pull_request` workflow runs from random forks.
4. **Verify Dependabot is active** — repo Settings → Code security → Dependabot alerts and security updates enabled. The `dependabot.yml` already auto-bumps Action SHAs weekly; this keeps the pins fresh.

The threat model these defenses address is the now-familiar npm supply-chain class of attack: a `pull_request_target` "Pwn Request" landing attacker code on a trusted runner, Actions cache poisoning across the fork→base trust boundary, and OIDC token extraction from runner memory during the trusted publish. Every workflow in `.github/workflows/` is structured to close one of those vectors. See the comments in each YAML for which.

## License

ISC
