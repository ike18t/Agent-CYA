import { Command } from "commander";
import { evaluateHardDeny } from "./rules.ts";
import { review } from "./llm.ts";
import { createAuditLogger } from "./audit-log.ts";
import { enrichBashFileContent } from "./file-enrich.ts";
import {
  parseClaudeCodeHookInput,
  formatClaudeCodeHookOutput,
  exitCodeForDecision,
} from "./hook-claude-code.ts";
import type { ReviewInput } from "./prompt.ts";
import type { LlmDecision } from "./llm.ts";

const program = new Command();

program
  .name("agent-cya")
  .description(
    "CLI that reviews AI coding assistant tool calls before execution",
  )
  .version("1.0.0");

/* eslint-disable functional/no-let, functional/no-loop-statements -- for await is the only stack-safe way to read stdin */
const readStdin = async (): Promise<string> => {
  let acc = "";
  for await (const chunk of process.stdin) acc += chunk.toString();
  return acc;
};
/* eslint-enable functional/no-let, functional/no-loop-statements */

const parseInput = (raw: string): ReviewInput => {
  const parsed = JSON.parse(raw);
  const toolType = parsed.toolType;
  const command = parsed.command;

  if (!toolType || typeof toolType !== "string") {
    throw new Error("missing or invalid 'toolType' in input");
  }
  if (!command || typeof command !== "string") {
    throw new Error("missing or invalid 'command' in input");
  }

  return {
    toolType,
    command,
    fileContent:
      typeof parsed.fileContent === "string" ? parsed.fileContent : null,
    workingDirectory: parsed.workingDirectory,
  };
};

const evaluateRequest = async (
  input: Readonly<ReviewInput>,
  platform: "opencode" | "claude",
): Promise<Readonly<{ decision: LlmDecision; source: "rule" | "llm" }>> => {
  const denyResult = evaluateHardDeny(input.command);
  if (denyResult) return { decision: denyResult, source: "rule" };
  const enriched = enrichBashFileContent(input);
  const decision = await review(enriched, platform);
  return { decision, source: "llm" };
};

const writeAudit = (
  input: Readonly<ReviewInput>,
  decision: Readonly<LlmDecision>,
  source: "rule" | "llm",
  audit: ReturnType<typeof createAuditLogger>,
): void => {
  audit.write({
    timestamp: new Date().toISOString(),
    tool: input.toolType,
    command: input.command,
    decision: decision.decision,
    reason: decision.reason,
    source,
  });
};

const runReview = async (
  stdinRaw: string,
  platform: "opencode" | "claude",
): Promise<number> => {
  const audit = createAuditLogger();

  try {
    const input = parseInput(stdinRaw);
    const { decision, source } = await evaluateRequest(input, platform);
    process.stdout.write(JSON.stringify(decision) + "\n");
    writeAudit(input, decision, source, audit);
    return decision.decision === "deny" ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent-cya] ${message}\n`);
    return 1;
  }
};

const runHookClaudeCode = async (
  stdinRaw: string,
  platform: "opencode" | "claude",
): Promise<number> => {
  const audit = createAuditLogger();

  try {
    const input = parseClaudeCodeHookInput(stdinRaw);
    const { decision, source } = await evaluateRequest(input, platform);
    process.stdout.write(formatClaudeCodeHookOutput(decision) + "\n");
    writeAudit(input, decision, source, audit);
    return exitCodeForDecision(decision);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent-cya] ${message}\n`);
    process.stdout.write(
      formatClaudeCodeHookOutput({
        decision: "ask",
        reason: `agent-cya error: ${message}`,
      }) + "\n",
    );
    return 1;
  }
};

const validatePlatform = (platform: string): "opencode" | "claude" => {
  if (platform !== "opencode" && platform !== "claude") {
    process.stderr.write(
      `[agent-cya] invalid platform '${platform}'. Must be 'opencode' or 'claude'\n`,
    );
    process.exit(1);
  }
  return platform;
};

program
  .command("review")
  .description("Review a tool call from stdin (agent-cya input format)")
  .requiredOption(
    "--platform <platform>",
    "Platform binary: 'claude' (claude CLI) or 'opencode' (opencode CLI)",
  )
  .action(async (options) => {
    const platform = validatePlatform(options.platform as string);
    const stdin = await readStdin();
    const exitCode = await runReview(stdin, platform);
    process.exit(exitCode);
  });

program
  .command("hook-claude-code")
  .description(
    "Run as a Claude Code PermissionRequest hook (reads/writes Claude Code's hook format)",
  )
  .option(
    "--platform <platform>",
    "Platform binary: 'claude' or 'opencode'",
    "claude",
  )
  .action(async (options) => {
    const platform = validatePlatform(options.platform as string);
    const stdin = await readStdin();
    const exitCode = await runHookClaudeCode(stdin, platform);
    process.exit(exitCode);
  });

export { runReview, runHookClaudeCode, parseInput, program };
