import { Command } from "commander";
import { evaluateHardDeny } from "./rules.ts";
import { review } from "./llm.ts";
import { createAuditLogger } from "./audit-log.ts";
import { enrichBashFileContent } from "./file-enrich.ts";
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

const commit = (
  input: Readonly<ReviewInput>,
  decision: Readonly<LlmDecision>,
  source: "rule" | "llm",
  audit: ReturnType<typeof createAuditLogger>,
): number => {
  process.stdout.write(JSON.stringify(decision) + "\n");
  audit.write({
    timestamp: new Date().toISOString(),
    tool: input.toolType,
    command: input.command,
    decision: decision.decision,
    reason: decision.reason,
    source,
  });
  return decision.decision === "deny" ? 1 : 0;
};

const runReview = async (
  stdinRaw: string,
  platform: "opencode" | "claude",
): Promise<number> => {
  const audit = createAuditLogger();

  try {
    const input = parseInput(stdinRaw);

    const denyResult = evaluateHardDeny(input.command);
    if (denyResult) {
      return commit(input, denyResult, "rule", audit);
    }

    const enriched = enrichBashFileContent(input);
    const llmResult: LlmDecision = await review(enriched, platform);
    return commit(input, llmResult, "llm", audit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent-cya] ${message}\n`);
    return 1;
  }
};

program
  .command("review")
  .description("Review a tool call from stdin")
  .requiredOption(
    "--platform <platform>",
    "Platform binary: 'claude' (claude CLI) or 'opencode' (opencode CLI)",
  )
  .action(async (options) => {
    const platform = options.platform as string;
    if (platform !== "opencode" && platform !== "claude") {
      process.stderr.write(
        `[agent-cya] invalid platform '${platform}'. Must be 'opencode' or 'claude'\n`,
      );
      process.exit(1);
    }
    const stdin = await readStdin();
    const exitCode = await runReview(stdin, platform);
    process.exit(exitCode);
  });

export { runReview, parseInput, program };
