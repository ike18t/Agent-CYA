# AgentCYA

A second-LLM permission reviewer for AI coding assistants (Claude Code, OpenCode).

## Why

You're usually choosing between two bad options: `--dangerously-skip-permissions` lets the agent rip but auto-approves anything it dreams up, while the default permission flow buries you in a prompt for every other command. AgentCYA is the middle path — a separate LLM reviews each tool call (and reads the contents of scripts it's about to execute) and decides `allow` / `deny` / `ask` on the merits, so the agent keeps moving on routine work and only pulls you in when the risk actually warrants it.

## How It Works

AgentCYA sits between the coding assistant and execution. The decision pipeline is:

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
echo '{"toolType":"Bash","command":"ls"}' | \
  node src/main.ts review --platform claude
```

Node 23.9+ is required for native `.ts` execution. No compilation step — source runs directly.

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
            "command": "agent-cya hook-claude-code",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

The `hook-claude-code` subcommand reads Claude Code's `PermissionRequest` input on stdin, runs the review pipeline, and emits a `hookSpecificOutput` decision. It reviews via the `claude` CLI by default; pass `--platform opencode` (or set `AGENT_CYA_PLATFORM=opencode` in the hook command) to use OpenCode instead. To gate file edits too, widen the matcher to `"Bash|Write|Edit"`.

The hook only fires when Claude Code would otherwise prompt for permission — already-allowlisted commands skip it. AgentCYA's `allow` / `deny` / `ask` decisions map directly to `PermissionRequest` behaviors; `ask` falls through to Claude Code's standard permission dialog.

> ⚠️ **Watch out for "autopilot accept" on fallback prompts.** When the reviewer LLM is unreachable or returns `ask`, Claude Code surfaces its **standard approval prompt** — visually identical to any routine permission ask, with no AgentCYA reasoning attached. With a fast reviewer the prompt can flash for just a few seconds before the hook lands a final decision, making it easy to dismiss reflexively. Two specific failure modes:
>
> 1. **Clicking "Yes"** runs the command once. Annoying but recoverable — the audit log captures what got through.
> 2. **Clicking "Yes, and don't ask again for X"** adds the command pattern to your allowlist, which **bypasses the hook entirely** for future matches. Worse than #1 and silent.
>
> To give yourself a real interaction window, AgentCYA **pads `ask` decisions to a configurable minimum wall-clock duration** (default **60 seconds** via `AGENT_CYA_MIN_ASK_MS`). Allows and denies still return as fast as the LLM does; only the genuinely ambiguous calls hold the prompt open long enough to actually look at. Set `AGENT_CYA_MIN_ASK_MS=0` to disable padding, or any other value (e.g. `30000` for 30s) to tune the window. Make sure the hook `timeout` (seconds) is greater than `AGENT_CYA_MIN_ASK_MS / 1000` plus your LLM's worst-case review time.
>
> If you see an unexpected approval prompt while AgentCYA is installed, treat it as a signal that the reviewer isn't reaching the LLM — check `~/.local/state/agent-cya/claude-hook.log` for the cause before accepting.

### As an OpenCode Plugin

OpenCode loads plugins as TypeScript/JavaScript modules from your own plugins folder, so AgentCYA stays out of the import path — you just spawn the `agent-cya` CLI from a tiny plugin you control. Drop this file into your OpenCode plugins directory:

```typescript
// ~/.config/opencode/plugins/agent-cya.ts
import { spawn } from "node:child_process";

type Decision = { decision: "allow" | "deny" | "ask"; reason: string };

const runAgentCya = (input: object): Promise<Decision> =>
  new Promise((resolve) => {
    const child = spawn("agent-cya", ["review", "--platform", "claude"], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.on("close", () => {
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        resolve({ decision: "ask", reason: "agent-cya returned no JSON" });
      }
    });
    child.stdin.end(JSON.stringify(input));
  });

export const AgentCyaGuard = async () => ({
  "permission.ask": async (
    input: { type?: string; pattern?: string },
    output: { status: "ask" | "deny" | "allow" },
  ) => {
    const verdict = await runAgentCya({
      toolType: input.type ?? "Bash",
      command: input.pattern ?? "",
      fileContent: null,
    });
    output.status = verdict.decision;
  },
});
```

This uses OpenCode's `permission.ask` hook — the native interception point for permission decisions. Setting `output.status` to `"allow"` / `"deny"` / `"ask"` directly drives OpenCode's permission flow, with no exception-throwing or other workarounds. Adjust the `--platform` arg if you want OpenCode itself (rather than `claude`) to do the reviewing.

Then enable it in your OpenCode config:

```json
{ "plugins": ["./plugins/agent-cya.ts"] }
```

## CLI

```
agent-cya review --platform <platform>          # review a tool call in AgentCYA's input format
agent-cya hook-claude-code [--platform <p>]     # run as a Claude Code PermissionRequest hook
```

| Subcommand         | Purpose                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `review`           | Reads AgentCYA's native input on stdin, emits `{decision, reason}` JSON. Use this from your own integrations (OpenCode etc.). |
| `hook-claude-code` | Reads Claude Code's `PermissionRequest` input, emits `hookSpecificOutput` JSON, exits 2 on deny. Wire this up directly.       |

`--platform` is `claude` (default for `hook-claude-code`) or `opencode` — which CLI binary spawns for LLM review.

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
├── main.ts             # Entry point: imports program from cli.ts, calls program.parse()
├── cli.ts              # Commander.js CLI, dispatches to review / hook-claude-code
├── hook-claude-code.ts # Claude Code PermissionRequest adapter (input/output transforms)
├── rules.ts            # Hardcoded deny regex patterns, evaluateHardDeny()
├── file-enrich.ts      # For Bash commands that run a script, reads file contents from disk
├── prompt.ts           # buildSystemPrompt() + buildUserPrompt() with XML sections
├── llm.ts              # Spawns claude/opencode CLI binary, 90s timeout, retry, JSON extractor
└── audit-log.ts        # JSON-lines writer at ~/.agent-cya/audit.log with size-cap rotation
```

Key design decisions:

- **No config file** — deny patterns are hardcoded, not user-configurable
- **No HTTP, no API keys** — LLM review shells out to the `claude` or `opencode` CLI binary via `child_process.spawn`
- **No compilation** — runs directly with `node`; all imports use `.ts` extensions

## Tech Stack

- TypeScript (no compilation — `node`)
- Commander.js — CLI framework
- Vitest — Testing

## License

ISC
