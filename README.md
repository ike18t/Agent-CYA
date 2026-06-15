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
3. **LLM review** — Everything else is sent to the reviewer for a security assessment. By default this is the `claude` or `opencode` CLI binary spawned locally; `--reviewer openai` makes an HTTP call to an OpenAI-compatible API configured at `~/.agent-cya/config.json` (see [Reviewer config file](#reviewer-config-file)).
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

### Reviewer config file

The `claude` and `opencode` reviewers need no configuration — they pick up the local CLI's existing auth. The `openai` reviewer makes an HTTP call to an OpenAI-compatible API and needs to know which endpoint, which model, and which API key to use. That lives in `~/.agent-cya/config.json`:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/agent-cya/config.schema.json",
  "reviewers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o-mini",
      "apiKey": "sk-..."
    }
  }
}
```

The `$schema` line is optional — it enables autocomplete, inline docs, and typo detection in any editor that understands JSON Schema (VS Code, JetBrains, Neovim with a JSON LSP, etc.). The schema is also shipped in the npm package at `node_modules/agent-cya/config.schema.json` if you'd rather reference it locally.

Keep the file readable only by you:

```bash
chmod 600 ~/.agent-cya/config.json
```

AgentCYA warns on stderr if the mode is more permissive, but does not refuse to read it.

#### API key via credential helper

Set `apiKeyCmd` to a shell command whose stdout is the key; AgentCYA runs it and uses the trimmed output. If both `apiKey` and `apiKeyCmd` are present, `apiKeyCmd` wins (matches git's credential-helper precedence).

Examples:

- **1Password CLI** (any platform):

  ```json
  { "apiKeyCmd": "op read op://Personal/openai-agent-cya/credential" }
  ```

- **macOS Keychain**:

  ```bash
  security add-generic-password -s agent-cya-openai -a "$USER" -w "sk-..."
  ```

  ```json
  { "apiKeyCmd": "security find-generic-password -s agent-cya-openai -w" }
  ```

- **Windows Credential Manager** (via PowerShell SecretManagement):

  ```powershell
  Set-Secret -Name agent-cya-openai -Secret 'sk-...'
  ```

  ```json
  {
    "apiKeyCmd": "powershell -NoProfile -Command \"Get-Secret -Name agent-cya-openai -AsPlainText\""
  }
  ```

- **Bitwarden CLI** (any platform):

  ```json
  { "apiKeyCmd": "bw get password agent-cya-openai" }
  ```

- **HashiCorp Vault** (any platform):

  ```json
  { "apiKeyCmd": "vault kv get -field=apikey kv/agent-cya/openai" }
  ```

The helper command runs with `shell: true` (so pipes and quoting work the way you'd expect from a shell) and a 5-second timeout. Its stderr is surfaced in error messages, so debugging "why doesn't my helper work" goes through normal CLI channels.

#### Using a local model as the reviewer

The OpenAI-compatible API spec is widely implemented, so the `openai` reviewer works against any locally-running inference server too. Reasons you might want to:

- **Privacy** — every tool call and the contents of every script being executed reach the reviewer. With a local model, nothing leaves your machine.
- **Cost** — no per-call API fees. A small (~7B-9B) model on a modern laptop reviews each call in ~5 seconds, comparable to spawning the `claude` CLI.
- **Offline** — works on planes, in restricted networks, behind corporate proxies.

Anything OpenAI-compatible works: Ollama, vLLM, LM Studio, llama.cpp's built-in server, MLX-LM, oMLX, LiteLLM, and most other runtimes. For local servers that don't need auth, set `apiKey` to any non-empty placeholder — the field is required but the server can ignore the header.

Example with Ollama:

```bash
ollama pull qwen2.5-coder:7b
```

```json
{
  "reviewers": {
    "openai": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "qwen2.5-coder:7b",
      "apiKey": "unused"
    }
  }
}
```

Cloud and hosted services (OpenAI, Together, Groq, Mistral, etc.) work identically — just point `baseUrl` at the provider, set `model` to one they offer, and supply your real API key.

## CLI

```
agent-cya [--reviewer <reviewer>] review              # review a tool call in AgentCYA's input format
agent-cya [--reviewer <reviewer>] hook claude-code    # run as a Claude Code PermissionRequest hook
```

| Subcommand         | Purpose                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `review`           | Reads AgentCYA's native input on stdin, emits `{decision, reason}` JSON. Useful for shell-level debugging and ad-hoc integrations. |
| `hook claude-code` | Reads Claude Code's `PermissionRequest` input, emits `hookSpecificOutput` JSON, exits 2 on deny. Wire this up directly.            |

`--reviewer` is `claude` (default), `opencode`, or `openai`. The first two spawn the matching CLI binary; `openai` calls a chat-completions HTTP endpoint configured at `~/.agent-cya/config.json` (see [Reviewer config file](#reviewer-config-file)). It's a global option on `agent-cya`, so pass it before the subcommand.

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
├── main.ts                       # Entry point: imports program from cli.ts, calls program.parse()
├── cli.ts                        # Commander.js CLI, dispatches to review / hook claude-code
├── pipeline.ts                   # evaluate(): hard-deny → enrich → reviewer → audit
├── rules.ts                      # Hardcoded deny regex patterns, evaluateHardDeny()
├── file-enrich.ts                # For Bash commands that run a script, reads the file from disk
├── audit-log.ts                  # JSON-lines writer at ~/.agent-cya/audit.log with size-cap rotation
├── harnesses/
│   ├── claude-code.ts            # Claude Code PermissionRequest adapter
│   └── opencode-plugin.ts        # OpenCode plugin subpath export: createAgentCyaPlugin() factory
└── reviewers/
    ├── review.ts                 # review() public entry: dispatches to a transport, applies ask-padding
    ├── cli-binary.ts             # reviewViaCliBinary(): spawn-based path for claude/opencode CLIs
    ├── openai.ts                 # reviewViaOpenAI(): chat/completions HTTP call, AbortController timeout
    ├── parse.ts                  # parseLlmResponse(): JSON extractor shared by both transports
    ├── prompt.ts                 # buildSystemPrompt() + buildUserPrompt() with XML sections (transport-agnostic)
    └── config.ts                 # loadOpenAIConfig(): reads ~/.agent-cya/config.json, resolves apiKey/apiKeyCmd
```

Key design decisions:

- **Deny patterns hardcoded** — the hard-deny regex list is not user-configurable
- **HTTP is opt-in** — by default LLM review shells out to the `claude` or `opencode` CLI binary via `child_process.spawn`. `--reviewer openai` opts into HTTP via `~/.agent-cya/config.json`; no HTTP otherwise
- **TypeScript end-to-end** — `node` runs `.ts` directly in development; the npm package ships compiled JS in `dist/` via a `prepack` `tsc` step

## Tech Stack

- TypeScript — `node` runs source in dev; `tsc` compiles to `dist/` for the published tarball
- Commander.js — CLI framework
- Vitest — Testing

## Releasing

Releases are driven by [release-please](https://github.com/googleapis/release-please) on `push: main`. Conventional commits (`feat:`, `fix:`, etc.) become a continuously-updated "release PR" with the bumped version + generated `CHANGELOG.md`. Merging that PR cuts a GitHub Release; the `publish.yml` workflow then publishes the tagged version to npm with provenance.

**One-time setup** (this list intentionally exists in the README so it can't drift silently — every item is part of the security posture, not optional polish):

1. **npm trusted publishing** — on npmjs.com, open the package's settings → "Publishing access" → add a trusted publisher with org `<your-org>`, repo `Agent-CYA` (match the GitHub repo name exactly, case-sensitive), workflow filename `publish.yml`, environment `npm-publish`. No `NPM_TOKEN` ever needs to exist for ongoing releases — the workflow mints a short-lived OIDC token per publish. (Caveat: npm trusted publishing requires the package to already exist on the registry, so the very first `0.1.0-alpha.1` publish has to be done manually from your machine with `npm publish --provenance=false --access public` after `npm login`. Every release after that goes through this workflow with provenance.)
2. **`npm-publish` environment with required reviewers** — repo Settings → Environments → New environment "npm-publish" → check "Required reviewers" and add yourself (or a small group). Every publish becomes one human click. This is the last-resort gate if any earlier defense fails.
3. **Restrict fork PR workflow runs** — repo Settings → Actions → General → "Fork pull request workflows from outside collaborators" → set to "Require approval for all outside collaborators" (or stricter). Prevents drive-by `pull_request` workflow runs from random forks.
4. **Verify Dependabot is active** — repo Settings → Code security → Dependabot alerts and security updates enabled. The `dependabot.yml` already auto-bumps Action SHAs weekly; this keeps the pins fresh.

The threat model these defenses address is the now-familiar npm supply-chain class of attack: a `pull_request_target` "Pwn Request" landing attacker code on a trusted runner, Actions cache poisoning across the fork→base trust boundary, and OIDC token extraction from runner memory during the trusted publish. Every workflow in `.github/workflows/` is structured to close one of those vectors. See the comments in each YAML for which.

## License

ISC
