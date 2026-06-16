# AGENTS.md

TypeScript CLI that reviews AI coding assistant tool calls before execution. No compilation step — runs directly with `node`.

## Quick Start

```bash
npm install
npm test                           # run all tests (vitest)
npm run lint                       # tsc + eslint + prettier + knip
node src/main.ts review --help   # run CLI
```

**Node versions**: development requires Node 23.9+ for native `.ts` execution (the dev path runs `node src/main.ts` directly). The published package targets Node 22+ — consumers install compiled JS from `dist/` and don't need 23.x.

## Commands

| Command                                                                                  | Purpose                                         |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `npm test`                                                                               | Run all tests                                   |
| `npm run lint`                                                                           | tsc + eslint + prettier + knip                  |
| `npm test -- src/cli.test.ts`                                                            | Run single test file                            |
| `echo '{"toolType":"Bash","command":"ls"}' \| node src/main.ts --reviewer claude review` | Manual review                                   |
| `node src/main.ts suggest`                                                               | Surface allowlist candidates from the audit log |

## Critical Gotchas

- **No compilation step**: Source runs directly with `node`. No `dist/` or `build/`. The bin script (`bin/agent-cya`) shells out to `node src/main.ts`.
- **`.ts` imports in `.ts` files**: All internal imports use `.ts` extensions (native Node ESM). Adding new modules requires `.ts` in the import path.
- **Tests included in tsconfig**: `src/**/*.test.ts` files are included in `tsconfig.json`. Running `npm run lint` type-checks both source and test files. `vitest/globals` is in the `types` array so LSP resolves `describe`/`it`/`expect`, but tests must still import from `"vitest"` explicitly.
- **`cli.test.ts` mocks `node:child_process`**: Must mock at top of file before importing `./cli.ts`, since `spawn` is used transitively.
- **HTTP is opt-in via `--reviewer openai`**: by default LLM review shells out to the `claude` or `opencode` CLI binary via `child_process.spawn`. When the user explicitly selects `--reviewer openai`, AgentCYA reads `~/.agent-cya/config.json` and calls a chat-completions endpoint via `fetch`. No HTTP otherwise.
- **`runReview` returns `number`**: Returns `0` (allow/ask) or `1` (deny/error). Caller in `program.action()` passes to `process.exit()`.

## Architecture

**Entry point**: `src/main.ts` → imports `program` from `src/cli.ts` → `program.parse(process.argv)`.

**Decision pipeline** (in order):

1. Parse stdin JSON → `src/cli.ts` (`parseInput`)
2. Structural rules (tree-sitter-bash AST predicates) → `src/rules.ts`
3. LLM review → `src/reviewers/review.ts` (dispatches to `cli-binary.ts` or `openai.ts`)
4. Audit log (always on) → `src/audit-log.ts`

**Layout**:

- `src/rules.ts` — tree-sitter-bash AST structural rules (~30 predicates), `evaluateRules()` returns allow/ask/deny
- `src/bash-ast.ts` — tree-sitter-bash wrapper; `parse()` returns a `Parsed` union (simple/pipeline/list/subshell/function/unknown)
- `src/cli.ts` — Commander.js CLI, stdin JSON → structural rules → LLM review → stdout JSON
- `src/pipeline.ts` — `evaluate()`: orchestrates rules → enrich → reviewer → audit
- `src/file-enrich.ts` — for Bash that runs a script, reads the script contents from disk
- `src/audit-log.ts` — always-on JSON-lines writer at `~/.agent-cya/audit.log`
- `src/suggest.ts` — `agent-cya suggest` subcommand; aggregates audit.log allows and clusters commands worth promoting to the harness allowlist
- `src/harnesses/claude-code.ts` — Claude Code PermissionRequest hook adapter
- `src/harnesses/opencode-plugin.ts` — OpenCode plugin subpath export
- `src/reviewers/review.ts` — `review()` public entry, dispatches to a transport
- `src/reviewers/cli-binary.ts` — spawn-based reviewer for `claude` / `opencode` binaries
- `src/reviewers/openai.ts` — HTTP reviewer for OpenAI-compatible endpoints
- `src/reviewers/parse.ts` — shared JSON extractor + `LlmDecision` type
- `src/reviewers/prompt.ts` — `buildSystemPrompt()` + `buildUserPrompt()`
- `src/reviewers/config.ts` — `loadOpenAIConfig()`, reads `~/.agent-cya/config.json`

**Input/Output**: JSON over stdin/stdout. Exit code `0` = allow/ask, `1` = deny/error.

**Reviewer flag**: `--reviewer claude` (default) and `--reviewer opencode` spawn the matching CLI binary. `--reviewer openai` calls an OpenAI-compatible HTTP endpoint configured at `~/.agent-cya/config.json`.

## Testing

- Framework: Vitest with `globals: true`
- Colocated tests: each `src/foo.ts` has a sibling `src/foo.test.ts`
- `src/reviewers/cli-binary.test.ts` and `src/cli.test.ts` mock `node:child_process.spawn`
- No integration tests: LLM calls are always mocked

## Tech Stack

- TypeScript — `node` runs source in dev; `tsc` compiles to `dist/` for the published tarball
- Commander.js — CLI framework
- Vitest — testing
- Native Node `fetch` for the `openai` reviewer's HTTP path
- `tree-sitter` + `tree-sitter-bash` — Bash AST for the structural rule layer
- No validation libraries (config schema is hand-rolled)

## Releasing

Releases are driven by [release-please](https://github.com/googleapis/release-please) on `push: main`. Conventional commits (`feat:`, `fix:`, etc.) become a continuously-updated "release PR" with the bumped version + generated `CHANGELOG.md`. Merging that PR cuts a GitHub Release; the `publish.yml` workflow then publishes the tagged version to npm with provenance.

**One-time setup** (each item is part of the security posture, not optional polish — kept here so it can't drift silently):

1. **npm trusted publishing** — on npmjs.com, open the package's settings → "Publishing access" → add a trusted publisher with org `<your-org>`, repo `Agent-CYA` (match the GitHub repo name exactly, case-sensitive), workflow filename `publish.yml`, environment `npm-publish`. No `NPM_TOKEN` ever needs to exist for ongoing releases — the workflow mints a short-lived OIDC token per publish. (Caveat: npm trusted publishing requires the package to already exist on the registry, so the very first `0.1.0-alpha.1` publish has to be done manually from your machine with `npm publish --provenance=false --access public` after `npm login`. Every release after that goes through this workflow with provenance.)
2. **`npm-publish` environment with required reviewers** — repo Settings → Environments → New environment "npm-publish" → check "Required reviewers" and add yourself (or a small group). Every publish becomes one human click. This is the last-resort gate if any earlier defense fails.
3. **Restrict fork PR workflow runs** — repo Settings → Actions → General → "Fork pull request workflows from outside collaborators" → set to "Require approval for all outside collaborators" (or stricter). Prevents drive-by `pull_request` workflow runs from random forks.
4. **Verify Dependabot is active** — repo Settings → Code security → Dependabot alerts and security updates enabled. The `dependabot.yml` already auto-bumps Action SHAs weekly; this keeps the pins fresh.

The threat model these defenses address is the now-familiar npm supply-chain class of attack: a `pull_request_target` "Pwn Request" landing attacker code on a trusted runner, Actions cache poisoning across the fork→base trust boundary, and OIDC token extraction from runner memory during the trusted publish. Every workflow in `.github/workflows/` is structured to close one of those vectors. See the comments in each YAML for which.
